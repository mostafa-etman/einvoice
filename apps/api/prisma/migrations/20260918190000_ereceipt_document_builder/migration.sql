-- eReceipt document builder: tenant/branch receipt type + Receipt rows.
-- Invoice tables and signing/canonical columns are untouched.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "default_receipt_type" VARCHAR(8) NOT NULL DEFAULT 's';

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "default_receipt_type" VARCHAR(8);

DO $$ BEGIN
  CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'READY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "receipts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "pos_device_id" UUID NOT NULL,
  "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
  "receipt_type" VARCHAR(8) NOT NULL,
  "type_version" TEXT NOT NULL DEFAULT '1.2',
  "receipt_number" TEXT NOT NULL,
  "date_time_issued" TIMESTAMPTZ NOT NULL,
  "currency_code" TEXT NOT NULL DEFAULT 'EGP',
  "exchange_rate" TEXT NOT NULL DEFAULT '0',
  "uuid" TEXT NOT NULL DEFAULT '',
  "previous_uuid" TEXT NOT NULL DEFAULT '',
  "reference_uuid" TEXT,
  "payment_method" TEXT NOT NULL,
  "order_delivery_mode" TEXT,
  "buyer_type" TEXT NOT NULL,
  "buyer_id" TEXT,
  "buyer_name" TEXT,
  "total_sales" TEXT NOT NULL DEFAULT '0.00',
  "net_amount" TEXT NOT NULL DEFAULT '0.00',
  "total_amount" TEXT NOT NULL DEFAULT '0.00',
  "eta_payload_json" JSONB NOT NULL,
  "eta_payload_text" TEXT NOT NULL,
  "uuid_canonical" TEXT NOT NULL,
  "canonical_preview" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "created_by_user_id" UUID,
  "updated_by_user_id" UUID,

  CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipts_tenant_id_pos_device_id_receipt_number_key"
  ON "receipts"("tenant_id", "pos_device_id", "receipt_number");

CREATE INDEX IF NOT EXISTS "receipts_tenant_id_date_time_issued_idx"
  ON "receipts"("tenant_id", "date_time_issued");

CREATE INDEX IF NOT EXISTS "receipts_tenant_id_pos_device_id_idx"
  ON "receipts"("tenant_id", "pos_device_id");

CREATE INDEX IF NOT EXISTS "receipts_tenant_id_uuid_idx"
  ON "receipts"("tenant_id", "uuid");

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_pos_device_id_fkey"
  FOREIGN KEY ("pos_device_id") REFERENCES "pos_devices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_receipts ON receipts;
CREATE POLICY tenant_isolation_receipts ON receipts
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
