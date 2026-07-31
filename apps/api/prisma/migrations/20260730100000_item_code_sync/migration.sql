-- Item code provenance + tenant sync runs

CREATE TYPE "ItemCodeSource" AS ENUM ('LOCAL', 'ETA');
CREATE TYPE "ItemCodeSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "item_codes"
  ADD COLUMN IF NOT EXISTS "source" "ItemCodeSource" NOT NULL DEFAULT 'LOCAL';

CREATE TABLE IF NOT EXISTS "item_code_sync_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "ItemCodeSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "added_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "errors_json" JSONB,
    "triggered_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_code_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "item_code_sync_runs_tenant_id_idx"
  ON "item_code_sync_runs"("tenant_id");
CREATE INDEX IF NOT EXISTS "item_code_sync_runs_tenant_id_created_at_idx"
  ON "item_code_sync_runs"("tenant_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'item_code_sync_runs_tenant_id_fkey'
  ) THEN
    ALTER TABLE "item_code_sync_runs"
      ADD CONSTRAINT "item_code_sync_runs_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE item_code_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_code_sync_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_item_code_sync_runs ON item_code_sync_runs;
CREATE POLICY tenant_isolation_item_code_sync_runs ON item_code_sync_runs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
