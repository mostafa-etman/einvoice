-- B2C eReceipt foundation: receipt-ready branch flags + tenant syndicate license
-- + POS device identity. Existing branches stay invoice-only (receipts_enabled = false).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "syndicate_license_number" TEXT;

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "receipts_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "syndicate_license_number" TEXT;

CREATE TYPE "PosDeviceStatus" AS ENUM ('ACTIVE', 'RETIRED', 'PERMANENTLY_RETIRED');

CREATE TABLE "pos_devices" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "serial_number" TEXT NOT NULL,
  "os_version" TEXT NOT NULL,
  "model_framework" TEXT NOT NULL,
  "pre_shared_key_ciphertext" BYTEA NOT NULL,
  "pre_shared_key_nonce" BYTEA NOT NULL,
  "status" "PosDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_receipt_uuid" TEXT NOT NULL DEFAULT '',
  "signing_device_id" UUID,
  "activated_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "retired_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_devices_tenant_id_serial_number_key"
  ON "pos_devices"("tenant_id", "serial_number");

CREATE INDEX "pos_devices_tenant_id_idx" ON "pos_devices"("tenant_id");
CREATE INDEX "pos_devices_tenant_id_branch_id_idx" ON "pos_devices"("tenant_id", "branch_id");
CREATE INDEX "pos_devices_tenant_id_status_idx" ON "pos_devices"("tenant_id", "status");

ALTER TABLE "pos_devices"
  ADD CONSTRAINT "pos_devices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pos_devices"
  ADD CONSTRAINT "pos_devices_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pos_devices"
  ADD CONSTRAINT "pos_devices_signing_device_id_fkey"
  FOREIGN KEY ("signing_device_id") REFERENCES "signing_devices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_devices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pos_devices ON pos_devices;
CREATE POLICY tenant_isolation_pos_devices ON pos_devices
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
