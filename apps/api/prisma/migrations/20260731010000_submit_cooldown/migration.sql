-- Document-level ETA submit cooldown / in-flight lock / attempt log

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "submit_cooldown_until" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "submit_in_flight" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "submit_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "submit_duplicate_retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "submit_attempt_log" JSONB,
  ADD COLUMN IF NOT EXISTS "submit_pending_retry_submission_id" UUID;

CREATE INDEX IF NOT EXISTS "documents_tenant_id_submit_cooldown_until_idx"
  ON "documents"("tenant_id", "submit_cooldown_until");

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
