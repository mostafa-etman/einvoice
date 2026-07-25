-- Tenant settings schema + RLS

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "eta_branch_code" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "activity_code" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "default_currency_code" TEXT;

CREATE TABLE IF NOT EXISTS "currencies" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_default_currency_code_fkey'
  ) THEN
    ALTER TABLE "branches"
      ADD CONSTRAINT "branches_default_currency_code_fkey"
      FOREIGN KEY ("default_currency_code") REFERENCES "currencies"("code")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_currencies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_currencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_currencies_tenant_id_currency_code_key"
  ON "tenant_currencies"("tenant_id", "currency_code");
CREATE INDEX IF NOT EXISTS "tenant_currencies_tenant_id_idx" ON "tenant_currencies"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_currencies_tenant_id_fkey') THEN
    ALTER TABLE "tenant_currencies"
      ADD CONSTRAINT "tenant_currencies_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_currencies_currency_code_fkey') THEN
    ALTER TABLE "tenant_currencies"
      ADD CONSTRAINT "tenant_currencies_currency_code_fkey"
      FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TYPE "ExchangeRateSource" AS ENUM ('MANUAL');

CREATE TABLE IF NOT EXISTS "exchange_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "base_currency_code" TEXT NOT NULL,
    "quote_currency_code" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" "ExchangeRateSource" NOT NULL DEFAULT 'MANUAL',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exchange_rates_tenant_id_base_currency_code_quote_currency_code_idx"
  ON "exchange_rates"("tenant_id", "base_currency_code", "quote_currency_code");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exchange_rates_tenant_id_fkey') THEN
    ALTER TABLE "exchange_rates"
      ADD CONSTRAINT "exchange_rates_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_eta_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "client_id" TEXT NOT NULL,
    "client_secret_ciphertext" BYTEA NOT NULL,
    "client_secret_nonce" BYTEA NOT NULL,
    "registration_number" TEXT,
    "activity_code" TEXT,
    "is_intermediary" BOOLEAN NOT NULL DEFAULT false,
    "on_behalf_of_registration_number" TEXT,
    "on_behalf_of_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_eta_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tenant_eta_credentials_tenant_id_idx" ON "tenant_eta_credentials"("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_eta_credentials_tenant_id_branch_id_idx"
  ON "tenant_eta_credentials"("tenant_id", "branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_eta_credentials_tenant_default_uidx"
  ON "tenant_eta_credentials"("tenant_id") WHERE "branch_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_eta_credentials_tenant_branch_uidx"
  ON "tenant_eta_credentials"("tenant_id", "branch_id") WHERE "branch_id" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_eta_credentials_tenant_id_fkey') THEN
    ALTER TABLE "tenant_eta_credentials"
      ADD CONSTRAINT "tenant_eta_credentials_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_eta_credentials_branch_id_fkey') THEN
    ALTER TABLE "tenant_eta_credentials"
      ADD CONSTRAINT "tenant_eta_credentials_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TYPE "ItemCodeType" AS ENUM ('EGS', 'GS1');

CREATE TABLE IF NOT EXISTS "item_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ItemCodeType" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_status" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_codes_tenant_id_type_code_key"
  ON "item_codes"("tenant_id", "type", "code");
CREATE INDEX IF NOT EXISTS "item_codes_tenant_id_idx" ON "item_codes"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_codes_tenant_id_fkey') THEN
    ALTER TABLE "item_codes"
      ADD CONSTRAINT "item_codes_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "currencies" ("code", "name_en", "name_ar", "decimals", "is_active", "created_at", "updated_at")
VALUES
  ('EGP', 'Egyptian Pound', 'الجنيه المصري', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('USD', 'US Dollar', 'دولار أمريكي', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('EUR', 'Euro', 'يورو', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- RLS
ALTER TABLE tenant_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_currencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_currencies ON tenant_currencies;
CREATE POLICY tenant_isolation_tenant_currencies ON tenant_currencies
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_exchange_rates ON exchange_rates;
CREATE POLICY tenant_isolation_exchange_rates ON exchange_rates
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE tenant_eta_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_eta_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_eta_credentials ON tenant_eta_credentials;
CREATE POLICY tenant_isolation_tenant_eta_credentials ON tenant_eta_credentials
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE item_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_item_codes ON item_codes;
CREATE POLICY tenant_isolation_item_codes ON item_codes
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
