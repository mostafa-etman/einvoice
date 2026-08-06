-- Usage analytics & metering (011)

CREATE TYPE "UsageMeter" AS ENUM (
  'issued',
  'received',
  'valid',
  'invalid',
  'api_calls',
  'storage_bytes'
);

CREATE TYPE "UsageExportFormat" AS ENUM ('CSV', 'XLSX');

CREATE TYPE "UsageExportJobStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'READY',
  'FAILED',
  'EXPIRED'
);

CREATE TABLE "usage_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "meter" "UsageMeter" NOT NULL,
  "quantity" DECIMAL(24, 6) NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "branch_id" UUID,
  "currency_code" TEXT,
  "document_id" UUID,
  "received_document_id" UUID,
  "idempotency_key" TEXT NOT NULL,
  "meta_json" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_events_tenant_id_meter_idempotency_key_key"
  ON "usage_events"("tenant_id", "meter", "idempotency_key");
CREATE INDEX "usage_events_tenant_id_occurred_at_idx"
  ON "usage_events"("tenant_id", "occurred_at");
CREATE INDEX "usage_events_tenant_id_meter_occurred_at_idx"
  ON "usage_events"("tenant_id", "meter", "occurred_at");
CREATE INDEX "usage_events_tenant_id_branch_id_occurred_at_idx"
  ON "usage_events"("tenant_id", "branch_id", "occurred_at");

CREATE TABLE "usage_daily_rollups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "bucket_date" DATE NOT NULL,
  "meter" "UsageMeter" NOT NULL,
  "branch_key" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  "currency_key" TEXT NOT NULL DEFAULT '',
  "value" DECIMAL(24, 6) NOT NULL,
  "event_count" INTEGER NOT NULL DEFAULT 0,
  "as_of" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_daily_rollups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_daily_rollups_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_daily_rollups_tenant_bucket_meter_dims_key"
  ON "usage_daily_rollups"("tenant_id", "bucket_date", "meter", "branch_key", "currency_key");
CREATE INDEX "usage_daily_rollups_tenant_id_bucket_date_idx"
  ON "usage_daily_rollups"("tenant_id", "bucket_date");
CREATE INDEX "usage_daily_rollups_tenant_id_meter_bucket_date_idx"
  ON "usage_daily_rollups"("tenant_id", "meter", "bucket_date");

CREATE TABLE "usage_monthly_rollups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "bucket_month" DATE NOT NULL,
  "meter" "UsageMeter" NOT NULL,
  "branch_key" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  "currency_key" TEXT NOT NULL DEFAULT '',
  "value" DECIMAL(24, 6) NOT NULL,
  "as_of" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_monthly_rollups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_monthly_rollups_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_monthly_rollups_tenant_month_meter_dims_key"
  ON "usage_monthly_rollups"("tenant_id", "bucket_month", "meter", "branch_key", "currency_key");
CREATE INDEX "usage_monthly_rollups_tenant_id_bucket_month_idx"
  ON "usage_monthly_rollups"("tenant_id", "bucket_month");
CREATE INDEX "usage_monthly_rollups_tenant_id_meter_bucket_month_idx"
  ON "usage_monthly_rollups"("tenant_id", "meter", "bucket_month");

CREATE TABLE "usage_export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "status" "UsageExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "format" "UsageExportFormat" NOT NULL,
  "filters_json" JSONB NOT NULL,
  "object_key" TEXT,
  "byte_size" INTEGER,
  "error_summary" TEXT,
  "expires_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_export_jobs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "usage_export_jobs_tenant_id_created_at_idx"
  ON "usage_export_jobs"("tenant_id", "created_at");
