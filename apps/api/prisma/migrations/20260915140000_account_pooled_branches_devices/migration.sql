-- Account-pooled branch + device limits (prep for B2C e-receipts).
--
-- CONSOLIDATION (do not lock out existing customers):
-- Previously each company independently used the plan's branch_quota /
-- device_quota (plus any per-tenant quota_override). The same numbers now cap
-- the whole ACCOUNT. To keep current usage valid:
--   extra_X = GREATEST(0,
--     GREATEST(SUM of previous per-company caps, actual used) - plan.X_quota)
-- A single-company account on a 1-branch / 1-device plan with one Main branch
-- and one device gets extras 0 — same 1/1 as today.

ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "extra_branches" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "extra_devices" INT NOT NULL DEFAULT 0;

WITH plan_q AS (
  SELECT
    a.id AS account_id,
    COALESCE(p.branch_quota, 1) AS plan_branches,
    COALESCE(p.device_quota, 1) AS plan_devices
  FROM accounts a
  LEFT JOIN subscriptions s ON s.account_id = a.id
  LEFT JOIN plans p ON p.id = s.plan_id
),
latest_override AS (
  SELECT DISTINCT ON (qo.tenant_id)
    qo.tenant_id,
    qo.branch_quota,
    qo.device_quota,
    qo.expires_at
  FROM quota_overrides qo
  ORDER BY qo.tenant_id, qo.created_at DESC
),
tenant_caps AS (
  SELECT
    t.account_id,
    CASE
      WHEN lo.branch_quota IS NOT NULL AND (lo.expires_at IS NULL OR lo.expires_at > now())
        THEN lo.branch_quota
      ELSE pq.plan_branches
    END AS branch_cap,
    CASE
      WHEN lo.device_quota IS NOT NULL AND (lo.expires_at IS NULL OR lo.expires_at > now())
        THEN lo.device_quota
      ELSE pq.plan_devices
    END AS device_cap
  FROM tenants t
  JOIN plan_q pq ON pq.account_id = t.account_id
  LEFT JOIN latest_override lo ON lo.tenant_id = t.id
),
cap_sum AS (
  SELECT
    account_id,
    SUM(branch_cap)::int AS branch_cap,
    SUM(device_cap)::int AS device_cap
  FROM tenant_caps
  GROUP BY account_id
),
branch_used AS (
  SELECT t.account_id, COUNT(*)::int AS used
  FROM tenants t
  JOIN branches b ON b.tenant_id = t.id AND b.is_active = true
  GROUP BY t.account_id
),
device_used AS (
  SELECT t.account_id, COUNT(*)::int AS used
  FROM tenants t
  JOIN signing_devices d ON d.tenant_id = t.id AND d.status = 'PAIRED'
  GROUP BY t.account_id
)
UPDATE accounts a SET
  extra_branches = GREATEST(
    0,
    GREATEST(COALESCE(c.branch_cap, 0), COALESCE(bu.used, 0)) - pq.plan_branches
  ),
  extra_devices = GREATEST(
    0,
    GREATEST(COALESCE(c.device_cap, 0), COALESCE(du.used, 0)) - pq.plan_devices
  )
FROM plan_q pq
LEFT JOIN cap_sum c ON c.account_id = pq.account_id
LEFT JOIN branch_used bu ON bu.account_id = pq.account_id
LEFT JOIN device_used du ON du.account_id = pq.account_id
WHERE a.id = pq.account_id;
