-- Distinguish transient ETA duplicate cooldown from true NEEDS_ATTENTION (FR-004d).

DO $$ BEGIN
  ALTER TYPE "SubmissionState" ADD VALUE 'WAITING_COOLDOWN';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "submissions"
  ADD COLUMN IF NOT EXISTS "eta_raw_response_json" JSONB;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
