-- CreateEnum
CREATE TYPE "PairingCodeStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED');
CREATE TYPE "DeviceStatus" AS ENUM ('PAIRED', 'REVOKED');
CREATE TYPE "SignatureJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum (DocumentStatus add SIGNED)
ALTER TYPE "DocumentStatus" ADD VALUE 'SIGNED';

-- AlterTable (Document signature fields)
ALTER TABLE "documents" ADD COLUMN "signatures_json" JSONB;
ALTER TABLE "documents" ADD COLUMN "signed_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "signed_by_device_id" UUID;

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_hint" TEXT,
    "status" "PairingCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" UUID,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_device_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "machine_fingerprint" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PAIRED',
    "token_hash" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_ready_json" JSONB,
    "paired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signing_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version" INTEGER NOT NULL,
    "status" "SignatureJobStatus" NOT NULL DEFAULT 'PENDING',
    "claimed_by_device_id" UUID,
    "claim_expires_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "signature_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pairing_codes_tenant_id_idx" ON "pairing_codes"("tenant_id");
CREATE INDEX "pairing_codes_code_hash_idx" ON "pairing_codes"("code_hash");

CREATE INDEX "signing_devices_tenant_id_idx" ON "signing_devices"("tenant_id");
CREATE INDEX "signing_devices_token_hash_idx" ON "signing_devices"("token_hash");

CREATE INDEX "signature_jobs_tenant_id_idx" ON "signature_jobs"("tenant_id");
CREATE INDEX "signature_jobs_tenant_id_status_idx" ON "signature_jobs"("tenant_id", "status");
CREATE INDEX "signature_jobs_document_id_idx" ON "signature_jobs"("document_id");

-- Enforce single active (PENDING/CLAIMED) job per document (data-model.md rule)
CREATE UNIQUE INDEX "signature_jobs_active_document_uidx" ON "signature_jobs"("document_id")
  WHERE "status" IN ('PENDING', 'CLAIMED');

ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_consumed_by_device_id_fkey" FOREIGN KEY ("consumed_by_device_id") REFERENCES "signing_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "signing_devices" ADD CONSTRAINT "signing_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signature_jobs" ADD CONSTRAINT "signature_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "signature_jobs" ADD CONSTRAINT "signature_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "signature_jobs" ADD CONSTRAINT "signature_jobs_claimed_by_device_id_fkey" FOREIGN KEY ("claimed_by_device_id") REFERENCES "signing_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_signed_by_device_id_fkey" FOREIGN KEY ("signed_by_device_id") REFERENCES "signing_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pairing_codes ON pairing_codes;
CREATE POLICY tenant_isolation_pairing_codes ON pairing_codes
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE signing_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_signing_devices ON signing_devices;
CREATE POLICY tenant_isolation_signing_devices ON signing_devices
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE signature_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_signature_jobs ON signature_jobs;
CREATE POLICY tenant_isolation_signature_jobs ON signature_jobs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
