-- SaaS layer: plans, subscriptions, quotas, billing, impersonation, email
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS provisioned_by_user_id UUID;

CREATE TYPE "PlanCode" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "ImpersonationMode" AS ENUM ('READ_ONLY', 'WRITE');
CREATE TYPE "BillingProviderId" AS ENUM ('stripe', 'local');
CREATE TYPE "EmailTemplate" AS ENUM (
  'onboarding_complete', 'plan_change', 'payment_success', 'payment_failure',
  'past_due', 'suspend', 'activate', 'quota_warn', 'impersonation_start'
);
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code "PlanCode" NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description_en TEXT,
  description_ar TEXT,
  document_quota INT NOT NULL,
  branch_quota INT NOT NULL,
  device_quota INT NOT NULL,
  self_serve BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  stripe_price_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  status "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  grace_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  provider "BillingProviderId",
  provider_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_status_grace_idx ON subscriptions(status, grace_ends_at);

CREATE TABLE quota_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_quota INT,
  branch_quota INT,
  device_quota INT,
  reason TEXT NOT NULL,
  created_by_user_id UUID NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quota_overrides_tenant_created_idx ON quota_overrides(tenant_id, created_at);

CREATE TABLE payment_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider "BillingProviderId" NOT NULL,
  provider_customer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE TABLE invoice_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider "BillingProviderId" NOT NULL,
  provider_invoice_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INT NOT NULL,
  currency TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  hosted_invoice_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_invoice_id)
);
CREATE INDEX invoice_refs_tenant_created_idx ON invoice_refs(tenant_id, created_at);

CREATE TABLE billing_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider "BillingProviderId" NOT NULL,
  provider_event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id UUID NOT NULL REFERENCES users(id),
  target_user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  mode "ImpersonationMode" NOT NULL DEFAULT 'READ_ONLY',
  break_glass_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX impersonation_sessions_tenant_expires_idx ON impersonation_sessions(tenant_id, expires_at);
CREATE INDEX impersonation_sessions_operator_ended_idx ON impersonation_sessions(operator_user_id, ended_at);

CREATE TABLE email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  template "EmailTemplate" NOT NULL,
  locale TEXT NOT NULL,
  to_email TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  payload_json JSONB NOT NULL,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_tenant_created_idx ON email_outbox(tenant_id, created_at);

-- Seed plan catalog
INSERT INTO plans (id, code, name_en, name_ar, document_quota, branch_quota, device_quota, self_serve, sort_order)
VALUES
  (gen_random_uuid(), 'FREE', 'Free', 'مجاني', 100, 1, 1, true, 1),
  (gen_random_uuid(), 'STARTER', 'Starter', 'مبتدئ', 500, 3, 3, true, 2),
  (gen_random_uuid(), 'PRO', 'Pro', 'احترافي', 2000, 10, 10, true, 3),
  (gen_random_uuid(), 'ENTERPRISE', 'Enterprise', 'مؤسسي', 20000, 50, 50, false, 4)
ON CONFLICT (code) DO NOTHING;
