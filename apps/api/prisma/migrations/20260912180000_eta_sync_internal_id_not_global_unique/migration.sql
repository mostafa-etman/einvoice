-- Invoice number (internal_id) is not globally unique for ETA-synced sales.
-- The same number can appear in different periods with different ETA UUIDs.
-- LOCAL and FILE_IMPORT documents remain unique per tenant.

DROP INDEX IF EXISTS "documents_tenant_id_internal_id_key";

CREATE UNIQUE INDEX "documents_tenant_internal_id_non_eta_sync_uidx"
  ON "documents"("tenant_id", "internal_id")
  WHERE "origin" <> 'ETA_SYNC';

CREATE INDEX "documents_tenant_id_internal_id_idx"
  ON "documents"("tenant_id", "internal_id");
