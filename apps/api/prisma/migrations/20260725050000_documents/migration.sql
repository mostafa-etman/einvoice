-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'EXPORT_INVOICE', 'EXPORT_CREDIT_NOTE', 'EXPORT_DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'READY');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "branch_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL,
    "exchange_rate" TEXT,
    "issue_date_time" TIMESTAMP(3) NOT NULL,
    "internal_id" TEXT NOT NULL,
    "eta_document_type" TEXT NOT NULL,
    "eta_document_type_version" TEXT NOT NULL,
    "type_version_fetched_at" TIMESTAMP(3) NOT NULL,
    "receiver_type" TEXT,
    "receiver_id" TEXT,
    "receiver_name" TEXT,
    "receiver_address_json" JSONB,
    "issuer_snapshot_json" JSONB NOT NULL,
    "references_json" JSONB,
    "extra_discount_amount" TEXT NOT NULL DEFAULT '0.00',
    "total_sales_amount" TEXT NOT NULL DEFAULT '0.00',
    "total_discount_amount" TEXT NOT NULL DEFAULT '0.00',
    "net_amount" TEXT NOT NULL DEFAULT '0.00',
    "total_amount" TEXT NOT NULL DEFAULT '0.00',
    "total_items_discount_amount" TEXT NOT NULL DEFAULT '0.00',
    "tax_totals_json" JSONB NOT NULL DEFAULT '[]',
    "eta_payload_json" JSONB NOT NULL,
    "canonical_preview" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit_price" TEXT NOT NULL,
    "currency_sold" TEXT,
    "amount_sold" TEXT,
    "amount_egp" TEXT,
    "currency_exchange_rate" TEXT,
    "discount_rate" TEXT,
    "discount_amount" TEXT NOT NULL DEFAULT '0.00',
    "sales_total" TEXT NOT NULL DEFAULT '0.00',
    "net_total" TEXT NOT NULL DEFAULT '0.00',
    "total" TEXT NOT NULL DEFAULT '0.00',
    "value_difference" TEXT NOT NULL DEFAULT '0.00',
    "total_taxable_fees" TEXT NOT NULL DEFAULT '0.00',
    "items_discount" TEXT NOT NULL DEFAULT '0.00',
    "internal_code" TEXT,

    CONSTRAINT "document_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_line_taxes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_line_id" UUID NOT NULL,
    "tax_type" TEXT NOT NULL,
    "sub_type" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "amount" TEXT NOT NULL,

    CONSTRAINT "document_line_taxes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "documents_tenant_id_internal_id_key" ON "documents"("tenant_id", "internal_id");
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");
CREATE INDEX "documents_tenant_id_status_idx" ON "documents"("tenant_id", "status");
CREATE UNIQUE INDEX "document_lines_document_id_line_number_key" ON "document_lines"("document_id", "line_number");
CREATE INDEX "document_lines_tenant_id_idx" ON "document_lines"("tenant_id");
CREATE INDEX "document_line_taxes_tenant_id_idx" ON "document_line_taxes"("tenant_id");

ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_line_taxes" ADD CONSTRAINT "document_line_taxes_document_line_id_fkey" FOREIGN KEY ("document_line_id") REFERENCES "document_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_documents ON documents;
CREATE POLICY tenant_isolation_documents ON documents
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_lines ON document_lines;
CREATE POLICY tenant_isolation_document_lines ON document_lines
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_line_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_line_taxes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_line_taxes ON document_line_taxes;
CREATE POLICY tenant_isolation_document_line_taxes ON document_line_taxes
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
