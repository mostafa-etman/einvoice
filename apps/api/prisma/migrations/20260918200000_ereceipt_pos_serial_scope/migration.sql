-- Tenant self-service: per-branch vs company-wide POS serial (previousUUID chain).
-- Invoice tables and signing columns are untouched. Existing receipt POS rows keep working.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "pos_serial_scope" VARCHAR(16) NOT NULL DEFAULT 'PER_BRANCH';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "shared_pos_device_id" UUID;

DO $$ BEGIN
  ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_shared_pos_device_id_fkey"
    FOREIGN KEY ("shared_pos_device_id") REFERENCES "pos_devices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
