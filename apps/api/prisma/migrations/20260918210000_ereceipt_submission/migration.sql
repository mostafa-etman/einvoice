-- eReceipt submission: ETA status, cooldown, in-flight. Invoice tables untouched.

ALTER TYPE "ReceiptStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "ReceiptStatus" ADD VALUE IF NOT EXISTS 'VALID';
ALTER TYPE "ReceiptStatus" ADD VALUE IF NOT EXISTS 'INVALID';

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "eta_status" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_long_id" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_environment" "EtaEnvironment",
  ADD COLUMN IF NOT EXISTS "submission_uuid" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_status_raw" JSONB,
  ADD COLUMN IF NOT EXISTS "eta_status_updated_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "submit_cooldown_until" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "submit_cooldown_payload_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "submit_in_flight" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "submit_in_flight_since" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "submit_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "submit_duplicate_retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "last_error_message" TEXT;
