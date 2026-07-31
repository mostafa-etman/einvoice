-- Purchases / received documents (008)
CREATE TYPE "ReceivedDocumentKind" AS ENUM ('PURCHASE_INVOICE', 'PURCHASE_RETURN', 'OTHER_RECEIVED');
CREATE TYPE "ReceivedBuyerDecision" AS ENUM ('NONE', 'ACCEPTED', 'REJECTED', 'DECLINED_CANCELATION', 'NEEDS_ATTENTION');
CREATE TYPE "ReceivedReconciliationStatus" AS ENUM ('PENDING_REVIEW', 'RECONCILED', 'DISPUTED');
CREATE TYPE "ReceivedSyncTrigger" AS ENUM ('CRON', 'MANUAL');
CREATE TYPE "ReceivedSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "received_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "document_uuid" TEXT NOT NULL,
  "eta_long_id" TEXT,
  "internal_id" TEXT,
  "eta_document_type" TEXT NOT NULL,
  "eta_document_type_version" TEXT,
  "kind" "ReceivedDocumentKind" NOT NULL,
  "eta_status" TEXT,
  "date_time_issued" TIMESTAMP(3),
  "issuer_type" TEXT,
  "issuer_id" TEXT,
  "issuer_name" TEXT,
  "issuer_json" JSONB,
  "receiver_json" JSONB,
  "currency" TEXT,
  "total_amount" TEXT,
  "net_amount" TEXT,
  "raw_summary_json" JSONB NOT NULL DEFAULT '{}',
  "raw_details_json" JSONB,
  "buyer_decision" "ReceivedBuyerDecision" NOT NULL DEFAULT 'NONE',
  "buyer_decision_reason" TEXT,
  "buyer_decision_at" TIMESTAMP(3),
  "buyer_decision_by_user_id" UUID,
  "reconciliation_status" "ReceivedReconciliationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reconciliation_note" TEXT,
  "purchase_order_link_id" UUID,
  "reconciliation_external_ref" TEXT,
  "branch_id" UUID,
  "needs_attention" BOOLEAN NOT NULL DEFAULT false,
  "needs_attention_reason" TEXT,
  "last_synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "received_documents_tenant_id_document_uuid_key" ON "received_documents"("tenant_id", "document_uuid");
CREATE INDEX "received_documents_tenant_id_idx" ON "received_documents"("tenant_id");
CREATE INDEX "received_documents_tenant_id_date_time_issued_idx" ON "received_documents"("tenant_id", "date_time_issued");
CREATE INDEX "received_documents_tenant_id_kind_idx" ON "received_documents"("tenant_id", "kind");
CREATE INDEX "received_documents_tenant_id_buyer_decision_idx" ON "received_documents"("tenant_id", "buyer_decision");
CREATE INDEX "received_documents_tenant_id_reconciliation_status_idx" ON "received_documents"("tenant_id", "reconciliation_status");
CREATE INDEX "received_documents_tenant_id_branch_id_idx" ON "received_documents"("tenant_id", "branch_id");

ALTER TABLE "received_documents"
  ADD CONSTRAINT "received_documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "received_documents"
  ADD CONSTRAINT "received_documents_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "received_document_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "received_document_id" UUID NOT NULL,
  "line_number" INTEGER,
  "description" TEXT,
  "item_code" TEXT,
  "item_type" TEXT,
  "unit_type" TEXT,
  "quantity" TEXT,
  "unit_price" TEXT,
  "net_total" TEXT,
  "total" TEXT,
  "taxes_json" JSONB NOT NULL DEFAULT '[]',
  "raw_json" JSONB,
  CONSTRAINT "received_document_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "received_document_lines_tenant_id_idx" ON "received_document_lines"("tenant_id");
CREATE INDEX "received_document_lines_received_document_id_idx" ON "received_document_lines"("received_document_id");

ALTER TABLE "received_document_lines"
  ADD CONSTRAINT "received_document_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "received_document_lines"
  ADD CONSTRAINT "received_document_lines_received_document_id_fkey"
  FOREIGN KEY ("received_document_id") REFERENCES "received_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "received_document_sync_runs" (
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
  CONSTRAINT "received_document_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "received_document_sync_runs_tenant_id_idx" ON "received_document_sync_runs"("tenant_id");
CREATE INDEX "received_document_sync_runs_tenant_id_created_at_idx" ON "received_document_sync_runs"("tenant_id", "created_at");

ALTER TABLE "received_document_sync_runs"
  ADD CONSTRAINT "received_document_sync_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_artifacts"
  ADD COLUMN IF NOT EXISTS "received_document_id" UUID;

CREATE INDEX IF NOT EXISTS "document_artifacts_received_document_id_idx"
  ON "document_artifacts"("received_document_id");

ALTER TABLE "document_artifacts"
  DROP CONSTRAINT IF EXISTS "document_artifacts_received_document_id_fkey";
ALTER TABLE "document_artifacts"
  ADD CONSTRAINT "document_artifacts_received_document_id_fkey"
  FOREIGN KEY ("received_document_id") REFERENCES "received_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE received_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE received_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_received_documents ON received_documents;
CREATE POLICY tenant_isolation_received_documents ON received_documents
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE received_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE received_document_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_received_document_lines ON received_document_lines;
CREATE POLICY tenant_isolation_received_document_lines ON received_document_lines
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE received_document_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE received_document_sync_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_received_document_sync_runs ON received_document_sync_runs;
CREATE POLICY tenant_isolation_received_document_sync_runs ON received_document_sync_runs
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
