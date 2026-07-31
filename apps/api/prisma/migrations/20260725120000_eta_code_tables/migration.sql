-- CreateEnum
CREATE TYPE "EtaCodeCatalogKind" AS ENUM (
  'TAX_TYPE',
  'TAX_SUBTYPE',
  'UNIT_TYPE',
  'WEIGHT_UNIT_TYPE',
  'CURRENCY',
  'COUNTRY',
  'ACTIVITY_CODE',
  'RECEIVER_TYPE',
  'ITEM_CODE_TYPE',
  'RETURN_REASON',
  'DOCUMENT_TYPE'
);

CREATE TABLE IF NOT EXISTS "eta_code_catalogs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" "EtaCodeCatalogKind" NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_file" TEXT,
  "content_hash" TEXT NOT NULL,
  "entry_count" INTEGER NOT NULL DEFAULT 0,
  "last_seeded_at" TIMESTAMPTZ,
  "last_synced_at" TIMESTAMPTZ,
  "sync_status" TEXT NOT NULL DEFAULT 'seeded',
  "sync_notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "eta_code_catalogs_kind_key" ON "eta_code_catalogs"("kind");

CREATE TABLE IF NOT EXISTS "eta_code_entries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "catalog_kind" "EtaCodeCatalogKind" NOT NULL,
  "code" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "name_ar" TEXT,
  "parent_code" TEXT,
  "meta" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "eta_code_entries_catalog_kind_fkey"
    FOREIGN KEY ("catalog_kind") REFERENCES "eta_code_catalogs"("kind")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "eta_code_entries_catalog_kind_code_key"
  ON "eta_code_entries"("catalog_kind", "code");
CREATE INDEX IF NOT EXISTS "eta_code_entries_catalog_kind_idx"
  ON "eta_code_entries"("catalog_kind");
CREATE INDEX IF NOT EXISTS "eta_code_entries_catalog_kind_parent_code_idx"
  ON "eta_code_entries"("catalog_kind", "parent_code");

-- Global catalogs — no FORCE RLS (readable by einvoice_app without tenant GUC).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
