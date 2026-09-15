-- Account-level billing: one subscription + one shared points pool per owner group.
--
-- CONSOLIDATION RULE (live customer data — do not lose plan or points):
-- 1. Group companies (tenants) by the earliest Owner membership's user_id.
--    Tenants with no Owner get a standalone account (owner_user_id NULL).
-- 2. Plan: take the earliest-created company in the group (the owner's first
--    company). If that plan is FREE/TRIAL and another company in the group has
--    a paid non-trial plan, keep the paid plan with the highest included_points
--    so we never silently downgrade.
-- 3. Points: SUM(points_balance) across the group so no credits are lost.
-- 4. trial_ends_at: if the chosen plan is a trial, MAX(trial_ends_at) in the
--    group; otherwise NULL (paid customers stay off trial).
-- 5. extra_users / extra_companies: SUM so purchased add-ons are kept.
-- 6. Keep one subscriptions row per account (the chosen plan); delete extras.
--    Re-tag PLAN_GRANT / TRIAL_GRANT / ADMIN_ADJUST / REFUND ledger rows as
--    account-level (tenant_id NULL) so grants are not replayed.
-- A single-company customer maps 1:1 — same plan, same points, no disruption.

CREATE TABLE "accounts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "points_balance" INT NOT NULL DEFAULT 0,
  "trial_ends_at" TIMESTAMPTZ,
  "extra_users" INT NOT NULL DEFAULT 0,
  "extra_companies" INT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "accounts_owner_user_id_uidx"
  ON "accounts" ("owner_user_id")
  WHERE "owner_user_id" IS NOT NULL;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "account_id" UUID;

CREATE TEMP TABLE account_groups AS
WITH owners AS (
  SELECT DISTINCT ON (m.tenant_id)
    m.tenant_id,
    m.user_id AS owner_user_id
  FROM memberships m
  JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
  WHERE r.name = 'Owner'
  ORDER BY m.tenant_id, m.created_at ASC
)
SELECT
  COALESCE(o.owner_user_id::text, 'tenant:' || t.id::text) AS group_key,
  o.owner_user_id,
  t.id AS tenant_id,
  t.created_at,
  t.points_balance,
  t.trial_ends_at,
  t.extra_users,
  t.extra_companies
FROM tenants t
LEFT JOIN owners o ON o.tenant_id = t.id;

CREATE TEMP TABLE new_accounts AS
SELECT
  gen_random_uuid() AS account_id,
  group_key,
  MIN(owner_user_id::text)::uuid AS owner_user_id
FROM account_groups
GROUP BY group_key;

INSERT INTO accounts (id, owner_user_id, points_balance, trial_ends_at, extra_users, extra_companies, created_at, updated_at)
SELECT account_id, owner_user_id, 0, NULL, 0, 0, now(), now()
FROM new_accounts;

UPDATE tenants t
SET account_id = n.account_id
FROM account_groups g
JOIN new_accounts n ON n.group_key = g.group_key
WHERE t.id = g.tenant_id;

UPDATE accounts a SET
  points_balance = s.points,
  extra_users = s.extra_users,
  extra_companies = s.extra_companies
FROM (
  SELECT
    account_id,
    COALESCE(SUM(points_balance), 0) AS points,
    COALESCE(SUM(extra_users), 0) AS extra_users,
    COALESCE(SUM(extra_companies), 0) AS extra_companies
  FROM tenants
  GROUP BY account_id
) s
WHERE a.id = s.account_id;

CREATE TEMP TABLE chosen_sub AS
WITH primary_sub AS (
  SELECT DISTINCT ON (t.account_id)
    t.account_id,
    s.id AS sub_id,
    p.is_trial,
    p.code AS plan_code
  FROM tenants t
  JOIN subscriptions s ON s.tenant_id = t.id
  JOIN plans p ON p.id = s.plan_id
  ORDER BY t.account_id, t.created_at ASC, s.created_at ASC
),
best_paid AS (
  SELECT DISTINCT ON (t.account_id)
    t.account_id,
    s.id AS sub_id
  FROM tenants t
  JOIN subscriptions s ON s.tenant_id = t.id
  JOIN plans p ON p.id = s.plan_id
  WHERE p.is_trial = false AND p.code <> 'FREE'
  ORDER BY t.account_id, p.included_points DESC, t.created_at ASC
)
SELECT
  p.account_id,
  CASE
    WHEN (p.is_trial OR p.plan_code = 'FREE') AND b.sub_id IS NOT NULL THEN b.sub_id
    ELSE p.sub_id
  END AS keep_id
FROM primary_sub p
LEFT JOIN best_paid b ON b.account_id = p.account_id;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS account_id UUID;

UPDATE subscriptions s
SET account_id = t.account_id
FROM tenants t
WHERE t.id = s.tenant_id;

DELETE FROM subscriptions s
WHERE s.account_id IS NOT NULL
  AND s.id NOT IN (SELECT keep_id FROM chosen_sub WHERE keep_id IS NOT NULL);

INSERT INTO subscriptions (id, account_id, plan_id, status, created_at, updated_at)
SELECT gen_random_uuid(), a.id, p.id, 'ACTIVE', now(), now()
FROM accounts a
CROSS JOIN plans p
WHERE p.code = 'FREE'
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id = a.id);

UPDATE accounts a
SET trial_ends_at = x.trial_ends_at
FROM (
  SELECT
    c.account_id,
    CASE
      WHEN p.is_trial THEN (
        SELECT MAX(t.trial_ends_at) FROM tenants t WHERE t.account_id = c.account_id
      )
      ELSE NULL
    END AS trial_ends_at
  FROM chosen_sub c
  JOIN subscriptions s ON s.id = c.keep_id
  JOIN plans p ON p.id = s.plan_id
) x
WHERE a.id = x.account_id;

ALTER TABLE subscriptions
  ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_key;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_fkey;

DROP POLICY IF EXISTS tenant_isolation_subscriptions ON subscriptions;

ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_account_id_key UNIQUE (account_id);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE tenants
  ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS tenants_account_id_idx ON tenants (account_id);

ALTER TABLE points_ledger
  ADD COLUMN IF NOT EXISTS account_id UUID;

UPDATE points_ledger l
SET account_id = t.account_id
FROM tenants t
WHERE t.id = l.tenant_id;

DELETE FROM points_ledger WHERE account_id IS NULL;

ALTER TABLE points_ledger
  ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE points_ledger
  ALTER COLUMN tenant_id DROP NOT NULL;

UPDATE points_ledger
SET tenant_id = NULL
WHERE reason IN ('PLAN_GRANT', 'TRIAL_GRANT', 'ADMIN_ADJUST', 'REFUND');

ALTER TABLE points_ledger
  ADD CONSTRAINT points_ledger_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS points_ledger_account_created_idx ON points_ledger (account_id, created_at);

ALTER TABLE tenants
  DROP COLUMN IF EXISTS points_balance,
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS extra_users,
  DROP COLUMN IF EXISTS extra_companies;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_isolation_accounts ON accounts;
CREATE POLICY account_isolation_accounts ON accounts
  USING (
    EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.account_id = accounts.id
        AND t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.account_id = accounts.id
        AND t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );

DROP POLICY IF EXISTS tenant_isolation_subscriptions ON subscriptions;
CREATE POLICY tenant_isolation_subscriptions ON subscriptions
  USING (
    account_id IN (
      SELECT t.account_id FROM tenants t
      WHERE t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT t.account_id FROM tenants t
      WHERE t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
  );

DROP POLICY IF EXISTS tenant_isolation_points_ledger ON points_ledger;
CREATE POLICY tenant_isolation_points_ledger ON points_ledger
  USING (
    (
      tenant_id IS NOT NULL
      AND tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
    OR (
      tenant_id IS NULL
      AND account_id IN (
        SELECT t.account_id FROM tenants t
        WHERE t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
      )
    )
  )
  WITH CHECK (
    (
      tenant_id IS NOT NULL
      AND tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
    OR (
      tenant_id IS NULL
      AND account_id IN (
        SELECT t.account_id FROM tenants t
        WHERE t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
