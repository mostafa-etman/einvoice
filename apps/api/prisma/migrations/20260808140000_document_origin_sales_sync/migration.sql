-- Document origin + issued (sales) sync runs
CREATE TYPE "DocumentOrigin" AS ENUM ('LOCAL', 'FILE_IMPORT', 'ETA_SYNC');

ALTER TABLE "documents"
  ADD COLUMN "origin" "DocumentOrigin" NOT NULL DEFAULT 'LOCAL';

CREATE UNIQUE INDEX "documents_tenant_id_eta_uuid_key"
  ON "documents"("tenant_id", "eta_uuid");

CREATE INDEX "documents_tenant_id_origin_idx"
  ON "documents"("tenant_id", "origin");

CREATE TABLE "issued_document_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "trigger" "ReceivedSyncTrigger" NOT NULL,
  "status" "ReceivedSyncRunStatus" NOT NULL DEFAULT 'PENDING',
  "fetched_count" INTEGER NOT NULL DEFAULT 0,
  "new_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "error_summary" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "triggered_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "issued_document_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "issued_document_sync_runs_tenant_id_idx"
  ON "issued_document_sync_runs"("tenant_id");
CREATE INDEX "issued_document_sync_runs_tenant_id_created_at_idx"
  ON "issued_document_sync_runs"("tenant_id", "created_at");

ALTER TABLE "issued_document_sync_runs"
  ADD CONSTRAINT "issued_document_sync_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE issued_document_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_document_sync_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_issued_document_sync_runs ON issued_document_sync_runs;
CREATE POLICY tenant_isolation_issued_document_sync_runs ON issued_document_sync_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
