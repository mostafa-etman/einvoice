-- One free trial per tax registration number (platform registry).
-- Plan.is_active already exists; inactive plans stay assigned but hidden from customer catalog.

CREATE TABLE trial_used_tax_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_registration_normalized TEXT NOT NULL UNIQUE,
  first_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trial_used_tax_registrations_tenant_idx
  ON trial_used_tax_registrations(first_tenant_id);

-- Platform catalog: tenant-scoped sessions cannot read/write.
-- Nest PrismaService (no app.tenant_id) and platform_operator can.
ALTER TABLE trial_used_tax_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_used_tax_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trial_used_tax_registrations_platform ON trial_used_tax_registrations;
CREATE POLICY trial_used_tax_registrations_platform ON trial_used_tax_registrations
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR NULLIF(current_setting('app.platform_operator', true), '') = '1'
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR NULLIF(current_setting('app.platform_operator', true), '') = '1'
  );

-- Migration-safe backfill: record tax numbers that already consumed a trial.
-- Does not change tenant rows, subscriptions, points, or trial clocks.
INSERT INTO trial_used_tax_registrations (tax_registration_normalized, first_tenant_id, consumed_at)
SELECT DISTINCT ON (norm.tax_registration_normalized)
  norm.tax_registration_normalized,
  norm.tenant_id,
  norm.consumed_at
FROM (
  SELECT
    upper(
      regexp_replace(
        translate(
          trim(c.registration_number),
          '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
          '01234567890123456789'
        ),
        '[\s\-_.]',
        '',
        'g'
      )
    ) AS tax_registration_normalized,
    t.id AS tenant_id,
    COALESCE(t.trial_ends_at, t.created_at) AS consumed_at
  FROM tenants t
  JOIN tenant_eta_credentials c ON c.tenant_id = t.id
  WHERE c.registration_number IS NOT NULL
    AND trim(c.registration_number) <> ''
    AND (
      t.trial_ends_at IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.tenant_id = t.id
          AND (p.is_trial = true OR s.status = 'TRIAL')
      )
      OR EXISTS (
        SELECT 1
        FROM points_ledger pl
        WHERE pl.tenant_id = t.id
          AND pl.reason::text = 'TRIAL_GRANT'
      )
    )
) norm
WHERE norm.tax_registration_normalized <> ''
ORDER BY norm.tax_registration_normalized, norm.consumed_at ASC
ON CONFLICT (tax_registration_normalized) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
