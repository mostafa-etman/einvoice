-- Tenants created before the SaaS layer never received a subscriptions row,
-- so the offer-pricing remap could not attach them to BASIC. Backfill those
-- rows (paid BASIC, never TRIAL) and grant included points so live customers
-- are not locked out of sending after invoice costs become 3.

INSERT INTO subscriptions (id, tenant_id, plan_id, status, created_at, updated_at)
SELECT gen_random_uuid(), t.id, p.id, 'ACTIVE', now(), now()
FROM tenants t
CROSS JOIN plans p
WHERE p.code = 'BASIC'
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);

UPDATE tenants SET trial_ends_at = NULL
WHERE trial_ends_at IS NOT NULL
  AND id IN (
    SELECT s.tenant_id FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE p.is_trial = false
  );

WITH granted AS (
  UPDATE tenants t
  SET points_balance = t.points_balance + p.included_points,
      updated_at = now()
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
  WHERE s.tenant_id = t.id
    AND t.activation_status = 'ACTIVE'
    AND t.suspended_at IS NULL
    AND t.points_balance = 0
    AND p.included_points > 0
    AND p.is_trial = false
    AND NOT EXISTS (
      SELECT 1 FROM points_ledger pl
      WHERE pl.tenant_id = t.id AND pl.reason::text = 'PLAN_GRANT'
    )
  RETURNING t.id, p.included_points AS delta, t.points_balance
)
INSERT INTO points_ledger (tenant_id, delta, balance_after, reason, note)
SELECT id, delta, points_balance, 'PLAN_GRANT', 'migrate:backfill-subscription'
FROM granted;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
