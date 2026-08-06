-- Allow separate ETA credentials per environment (sandbox + production).

DROP INDEX IF EXISTS "tenant_eta_credentials_tenant_default_uidx";
DROP INDEX IF EXISTS "tenant_eta_credentials_tenant_branch_uidx";

CREATE UNIQUE INDEX "tenant_eta_credentials_tenant_env_default_uidx"
  ON "tenant_eta_credentials"("tenant_id", "environment")
  WHERE "branch_id" IS NULL;

CREATE UNIQUE INDEX "tenant_eta_credentials_tenant_env_branch_uidx"
  ON "tenant_eta_credentials"("tenant_id", "environment", "branch_id")
  WHERE "branch_id" IS NOT NULL;
