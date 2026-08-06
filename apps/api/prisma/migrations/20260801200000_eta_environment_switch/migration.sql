-- Per-tenant ETA environment (sandbox ↔ production) + document stamping.

CREATE TYPE "EtaEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

ALTER TABLE "tenants"
  ADD COLUMN "active_eta_environment" "EtaEnvironment" NOT NULL DEFAULT 'SANDBOX';

ALTER TABLE "tenant_eta_credentials"
  ADD COLUMN "environment" "EtaEnvironment" NOT NULL DEFAULT 'SANDBOX',
  ADD COLUMN "last_validated_at" TIMESTAMP(3);

CREATE INDEX "tenant_eta_credentials_tenant_id_environment_branch_id_idx"
  ON "tenant_eta_credentials"("tenant_id", "environment", "branch_id");

ALTER TABLE "documents"
  ADD COLUMN "eta_environment" "EtaEnvironment";

-- Existing rows were created under the process-wide preprod hosts.
UPDATE "documents" SET "eta_environment" = 'SANDBOX' WHERE "eta_environment" IS NULL;

CREATE INDEX "documents_tenant_id_eta_environment_idx"
  ON "documents"("tenant_id", "eta_environment");

ALTER TABLE "submissions"
  ADD COLUMN "eta_environment" "EtaEnvironment";

UPDATE "submissions" SET "eta_environment" = 'SANDBOX' WHERE "eta_environment" IS NULL;

CREATE INDEX "submissions_tenant_id_eta_environment_idx"
  ON "submissions"("tenant_id", "eta_environment");

ALTER TABLE "received_documents"
  ADD COLUMN "eta_environment" "EtaEnvironment";

UPDATE "received_documents" SET "eta_environment" = 'SANDBOX' WHERE "eta_environment" IS NULL;

CREATE INDEX "received_documents_tenant_id_eta_environment_idx"
  ON "received_documents"("tenant_id", "eta_environment");
