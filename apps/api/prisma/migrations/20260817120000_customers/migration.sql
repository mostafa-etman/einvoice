-- Customers directory (tenant-scoped ETA receivers)
CREATE TABLE "customers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "registration_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_en" TEXT,
  "address_json" JSONB NOT NULL,
  "code" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_tenant_id_type_registration_id_key"
  ON "customers"("tenant_id", "type", "registration_id");

CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX "customers_tenant_id_name_idx" ON "customers"("tenant_id", "name");
CREATE INDEX "customers_tenant_id_code_idx" ON "customers"("tenant_id", "code");
CREATE INDEX "customers_tenant_id_is_active_idx" ON "customers"("tenant_id", "is_active");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
CREATE POLICY tenant_isolation_customers ON customers
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
