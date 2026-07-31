-- AlterEnum DocumentStatus
ALTER TYPE "DocumentStatus" ADD VALUE 'PENDING_SIGNATURE';
ALTER TYPE "DocumentStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "DocumentStatus" ADD VALUE 'VALID';
ALTER TYPE "DocumentStatus" ADD VALUE 'INVALID';
ALTER TYPE "DocumentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "DocumentStatus" ADD VALUE 'REJECTED';

CREATE TYPE "SubmissionState" AS ENUM (
  'ASSEMBLING',
  'SENT',
  'PARTIALLY_ACCEPTED',
  'RESOLVED',
  'NEEDS_ATTENTION'
);

CREATE TYPE "SubmissionDocumentAttemptOutcome" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REFUSED_AT_INTAKE',
  'VALID',
  'INVALID',
  'CANCELLED',
  'REJECTED'
);

CREATE TYPE "StatusEventSource" AS ENUM ('system', 'eta', 'user');

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "needs_attention" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "needs_attention_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_status" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_uuid" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_long_id" TEXT,
  ADD COLUMN IF NOT EXISTS "submission_uuid" TEXT,
  ADD COLUMN IF NOT EXISTS "eta_status_raw" JSONB,
  ADD COLUMN IF NOT EXISTS "eta_status_updated_at" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "submissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "batch_idempotency_key" TEXT NOT NULL,
  "parent_submission_id" UUID,
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "state" "SubmissionState" NOT NULL DEFAULT 'ASSEMBLING',
  "eta_submission_uuid" TEXT,
  "document_count" INTEGER NOT NULL DEFAULT 0,
  "accepted_count" INTEGER NOT NULL DEFAULT 0,
  "refused_count" INTEGER NOT NULL DEFAULT 0,
  "effective_max_docs" INTEGER,
  "effective_max_bytes" INTEGER,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "next_attempt_at" TIMESTAMPTZ,
  "created_by_user_id" UUID,
  "trigger_source" TEXT NOT NULL DEFAULT 'user',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submissions_parent_submission_id_fkey" FOREIGN KEY ("parent_submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "submissions_tenant_id_batch_idempotency_key_key"
  ON "submissions"("tenant_id", "batch_idempotency_key");
CREATE INDEX IF NOT EXISTS "submissions_tenant_id_idx" ON "submissions"("tenant_id");
CREATE INDEX IF NOT EXISTS "submissions_tenant_id_state_idx" ON "submissions"("tenant_id", "state");
CREATE INDEX IF NOT EXISTS "submissions_tenant_id_created_at_idx" ON "submissions"("tenant_id", "created_at");

CREATE TABLE IF NOT EXISTS "submission_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "attempt_outcome" "SubmissionDocumentAttemptOutcome" NOT NULL DEFAULT 'PENDING',
  "internal_id" TEXT NOT NULL,
  "eta_uuid" TEXT,
  "eta_long_id" TEXT,
  "intake_error_json" JSONB,
  "validation_errors_json" JSONB,
  "last_polled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "submission_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submission_documents_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submission_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "submission_documents_tenant_id_idx" ON "submission_documents"("tenant_id");
CREATE INDEX IF NOT EXISTS "submission_documents_submission_id_idx" ON "submission_documents"("submission_id");
CREATE INDEX IF NOT EXISTS "submission_documents_tenant_id_internal_id_idx" ON "submission_documents"("tenant_id", "internal_id");
CREATE INDEX IF NOT EXISTS "submission_documents_document_id_idx" ON "submission_documents"("document_id");

CREATE TABLE IF NOT EXISTS "document_filing_locks" (
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "submission_document_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_filing_locks_pkey" PRIMARY KEY ("tenant_id", "document_id", "document_version"),
  CONSTRAINT "document_filing_locks_submission_document_id_key" UNIQUE ("submission_document_id"),
  CONSTRAINT "document_filing_locks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_filing_locks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_filing_locks_submission_document_id_fkey" FOREIGN KEY ("submission_document_id") REFERENCES "submission_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "document_status_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "from_status" "DocumentStatus" NOT NULL,
  "to_status" "DocumentStatus" NOT NULL,
  "source" "StatusEventSource" NOT NULL,
  "eta_status_raw_snapshot" JSONB,
  "actor_user_id" UUID,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_status_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_status_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "document_status_events_tenant_id_idx" ON "document_status_events"("tenant_id");
CREATE INDEX IF NOT EXISTS "document_status_events_document_id_created_at_idx" ON "document_status_events"("document_id", "created_at");

CREATE TABLE IF NOT EXISTS "authority_notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "type" TEXT,
  "payload_json" JSONB NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "authority_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "authority_notifications_tenant_id_delivery_id_key"
  ON "authority_notifications"("tenant_id", "delivery_id");
CREATE INDEX IF NOT EXISTS "authority_notifications_tenant_id_idx" ON "authority_notifications"("tenant_id");

CREATE TABLE IF NOT EXISTS "document_artifacts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "document_id" UUID,
  "kind" TEXT NOT NULL,
  "eta_uuid" TEXT,
  "package_id" TEXT,
  "minio_bucket" TEXT NOT NULL,
  "minio_key" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_artifacts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "document_artifacts_tenant_id_idx" ON "document_artifacts"("tenant_id");
CREATE INDEX IF NOT EXISTS "document_artifacts_document_id_idx" ON "document_artifacts"("document_id");

CREATE TABLE IF NOT EXISTS "submission_trigger_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID,
  "auto_submit_on_create" BOOLEAN NOT NULL DEFAULT false,
  "max_docs_override" INTEGER,
  "max_bytes_override" INTEGER,
  "updated_by_user_id" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "submission_trigger_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "submission_trigger_settings_tenant_id_branch_id_key"
  ON "submission_trigger_settings"("tenant_id", "branch_id");
CREATE INDEX IF NOT EXISTS "submission_trigger_settings_tenant_id_idx" ON "submission_trigger_settings"("tenant_id");

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_submissions ON submissions;
CREATE POLICY tenant_isolation_submissions ON submissions
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE submission_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_submission_documents ON submission_documents;
CREATE POLICY tenant_isolation_submission_documents ON submission_documents
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_filing_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_filing_locks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_filing_locks ON document_filing_locks;
CREATE POLICY tenant_isolation_document_filing_locks ON document_filing_locks
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_status_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_status_events ON document_status_events;
CREATE POLICY tenant_isolation_document_status_events ON document_status_events
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE authority_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_authority_notifications ON authority_notifications;
CREATE POLICY tenant_isolation_authority_notifications ON authority_notifications
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_artifacts ON document_artifacts;
CREATE POLICY tenant_isolation_document_artifacts ON document_artifacts
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE submission_trigger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_trigger_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_submission_trigger_settings ON submission_trigger_settings;
CREATE POLICY tenant_isolation_submission_trigger_settings ON submission_trigger_settings
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
