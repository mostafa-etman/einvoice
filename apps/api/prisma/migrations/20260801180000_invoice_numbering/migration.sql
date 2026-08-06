-- Per-tenant document internalId numbering scheme + atomic sequences.

CREATE TYPE "InvoiceNumberCharset" AS ENUM ('NUMERIC', 'ALPHANUMERIC');
CREATE TYPE "InvoiceNumberScope" AS ENUM ('TENANT', 'BRANCH', 'DOCUMENT_KIND', 'BRANCH_AND_KIND');

CREATE TABLE "tenant_invoice_numbering" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'INV-',
    "pad_width" INTEGER NOT NULL DEFAULT 6,
    "starting_number" INTEGER NOT NULL DEFAULT 1,
    "charset" "InvoiceNumberCharset" NOT NULL DEFAULT 'NUMERIC',
    "scope" "InvoiceNumberScope" NOT NULL DEFAULT 'TENANT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_invoice_numbering_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_invoice_numbering_tenant_id_key" ON "tenant_invoice_numbering"("tenant_id");

ALTER TABLE "tenant_invoice_numbering"
  ADD CONSTRAINT "tenant_invoice_numbering_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document_number_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope_key" TEXT NOT NULL DEFAULT '',
    "branch_id" UUID,
    "document_kind" TEXT,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_number_sequences_tenant_id_scope_key_key"
  ON "document_number_sequences"("tenant_id", "scope_key");

CREATE INDEX "document_number_sequences_tenant_id_idx"
  ON "document_number_sequences"("tenant_id");

ALTER TABLE "document_number_sequences"
  ADD CONSTRAINT "document_number_sequences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_number_sequences"
  ADD CONSTRAINT "document_number_sequences_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default scheme for every existing tenant.
INSERT INTO "tenant_invoice_numbering" (
  "id", "tenant_id", "prefix", "pad_width", "starting_number", "charset", "scope", "created_at", "updated_at"
)
SELECT gen_random_uuid(), t."id", 'INV-', 6, 1, 'NUMERIC', 'TENANT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "tenant_invoice_numbering" n WHERE n."tenant_id" = t."id"
);

-- Seed TENANT-scoped sequence from highest INV-<digits> already used (best-effort).
INSERT INTO "document_number_sequences" (
  "id", "tenant_id", "scope_key", "branch_id", "document_kind", "last_value", "updated_at"
)
SELECT
  gen_random_uuid(),
  d."tenant_id",
  '',
  NULL,
  NULL,
  COALESCE(MAX(
    CASE
      WHEN d."internal_id" ~ '^INV-[0-9]+$'
      THEN CAST(substring(d."internal_id" from 5) AS BIGINT)
      ELSE 0
    END
  ), 0),
  CURRENT_TIMESTAMP
FROM "documents" d
GROUP BY d."tenant_id"
ON CONFLICT ("tenant_id", "scope_key") DO NOTHING;

-- RLS for numbering tables
ALTER TABLE tenant_invoice_numbering ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invoice_numbering FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_invoice_numbering ON tenant_invoice_numbering;
CREATE POLICY tenant_isolation_tenant_invoice_numbering ON tenant_invoice_numbering
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE document_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_number_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_number_sequences ON document_number_sequences;
CREATE POLICY tenant_isolation_document_number_sequences ON document_number_sequences
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
