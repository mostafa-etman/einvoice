-- Platform owner control plane: tenant activation gate, points ledger, plan
-- included points, per-document send costs, and platform settings.
-- Existing tenants are marked ACTIVE so current customers keep working.

CREATE TYPE "TenantActivationStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');
CREATE TYPE "PointsLedgerReason" AS ENUM ('PLAN_GRANT', 'ADMIN_ADJUST', 'DOCUMENT_SEND', 'REFUND');

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS activation_status "TenantActivationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS points_balance INT NOT NULL DEFAULT 0;

-- Anyone already in the product was effectively approved.
UPDATE tenants
SET activation_status = 'ACTIVE',
    approved_at = COALESCE(approved_at, created_at)
WHERE activation_status = 'PENDING';

ALTER TABLE plans ADD COLUMN IF NOT EXISTS included_points INT NOT NULL DEFAULT 0;

-- Plan.code was a Postgres enum; custom packages need a free-form slug.
ALTER TABLE plans ALTER COLUMN code TYPE TEXT USING code::text;
DROP TYPE IF EXISTS "PlanCode";

UPDATE plans SET included_points = 0 WHERE code = 'FREE';
UPDATE plans SET included_points = 500 WHERE code = 'STARTER';
UPDATE plans SET included_points = 2000 WHERE code = 'PRO';
UPDATE plans SET included_points = 20000 WHERE code = 'ENTERPRISE';

CREATE TABLE platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auto_activate_sub_companies BOOLEAN NOT NULL DEFAULT true,
  support_whatsapp_e164 TEXT NOT NULL DEFAULT '201000864620',
  support_whatsapp_display TEXT NOT NULL DEFAULT '00201000864620',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE document_point_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_kind TEXT NOT NULL UNIQUE,
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO document_point_costs (document_kind, points)
VALUES
  ('INVOICE', 0),
  ('CREDIT_NOTE', 0),
  ('DEBIT_NOTE', 0),
  ('EXPORT_INVOICE', 0),
  ('EXPORT_CREDIT_NOTE', 0),
  ('EXPORT_DEBIT_NOTE', 0),
  ('RECEIPT', 0)
ON CONFLICT (document_kind) DO NOTHING;

CREATE TABLE tenant_document_point_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_kind TEXT NOT NULL,
  points INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_kind)
);
CREATE INDEX tenant_document_point_costs_tenant_idx ON tenant_document_point_costs(tenant_id);

CREATE TABLE points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delta INT NOT NULL,
  balance_after INT NOT NULL,
  reason "PointsLedgerReason" NOT NULL,
  document_kind TEXT,
  document_id UUID,
  submission_id UUID,
  actor_user_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX points_ledger_tenant_created_idx ON points_ledger(tenant_id, created_at);

ALTER TABLE tenant_document_point_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_document_point_costs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_document_point_costs ON tenant_document_point_costs;
CREATE POLICY tenant_isolation_tenant_document_point_costs ON tenant_document_point_costs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_points_ledger ON points_ledger;
CREATE POLICY tenant_isolation_points_ledger ON points_ledger
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
