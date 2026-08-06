-- Offline sync: document idempotency + conflict table (010-offline-sync)

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "client_idempotency_key" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sync_revision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "documents_tenant_id_client_idempotency_key_key"
  ON "documents"("tenant_id", "client_idempotency_key");

CREATE TABLE IF NOT EXISTS "sync_conflicts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "client_idempotency_key" TEXT NOT NULL,
  "local_snapshot_json" JSONB NOT NULL,
  "server_snapshot_json" JSONB NOT NULL,
  "conflicting_paths_json" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "resolved_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sync_conflicts_tenant_id_idx" ON "sync_conflicts"("tenant_id");
CREATE INDEX IF NOT EXISTS "sync_conflicts_tenant_id_status_idx" ON "sync_conflicts"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "sync_conflicts_document_id_idx" ON "sync_conflicts"("document_id");

ALTER TABLE "sync_conflicts"
  ADD CONSTRAINT "sync_conflicts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_conflicts"
  ADD CONSTRAINT "sync_conflicts_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sync_conflicts ON sync_conflicts;
CREATE POLICY tenant_isolation_sync_conflicts ON sync_conflicts
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
