-- Tenant backup & restore (012)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_operator BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "TenantBackupJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');
CREATE TYPE "TenantBackupTriggerSource" AS ENUM ('MANUAL', 'SCHEDULE');
CREATE TYPE "TenantRestoreJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "TenantDataExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');

CREATE TABLE "tenant_backup_schedules" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "cron_expression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "next_run_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_backup_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_backup_schedules_tenant_id_key" ON "tenant_backup_schedules"("tenant_id");

CREATE TABLE "tenant_backup_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "status" "TenantBackupJobStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger_source" "TenantBackupTriggerSource" NOT NULL DEFAULT 'MANUAL',
  "schedule_id" UUID,
  "object_key" TEXT,
  "byte_size" BIGINT,
  "checksum_sha256" TEXT,
  "schema_version" TEXT NOT NULL DEFAULT '1',
  "error_code" TEXT,
  "error_message" TEXT,
  "created_by_user_id" UUID,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_backup_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_backup_jobs_tenant_id_created_at_idx" ON "tenant_backup_jobs"("tenant_id", "created_at");
CREATE INDEX "tenant_backup_jobs_tenant_id_status_idx" ON "tenant_backup_jobs"("tenant_id", "status");
CREATE INDEX "tenant_backup_jobs_tenant_id_trigger_source_created_at_idx" ON "tenant_backup_jobs"("tenant_id", "trigger_source", "created_at");

CREATE TABLE "tenant_restore_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "source_backup_job_id" UUID,
  "source_tenant_id" UUID NOT NULL,
  "source_checksum_sha256" TEXT NOT NULL,
  "source_object_key" TEXT,
  "status" "TenantRestoreJobStatus" NOT NULL DEFAULT 'QUEUED',
  "confirmation_token" TEXT NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_is_platform_operator" BOOLEAN NOT NULL DEFAULT false,
  "ownership_check_passed" BOOLEAN,
  "checksum_check_passed" BOOLEAN,
  "empty_org_check_passed" BOOLEAN,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_restore_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_restore_jobs_tenant_id_created_at_idx" ON "tenant_restore_jobs"("tenant_id", "created_at");

CREATE TABLE "tenant_data_export_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "status" "TenantDataExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "include_files" BOOLEAN NOT NULL DEFAULT false,
  "object_key" TEXT,
  "byte_size" BIGINT,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_by_user_id" UUID,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_data_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_data_export_jobs_tenant_id_created_at_idx" ON "tenant_data_export_jobs"("tenant_id", "created_at");

ALTER TABLE "tenant_backup_schedules" ADD CONSTRAINT "tenant_backup_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_backup_jobs" ADD CONSTRAINT "tenant_backup_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_backup_jobs" ADD CONSTRAINT "tenant_backup_jobs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "tenant_backup_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_restore_jobs" ADD CONSTRAINT "tenant_restore_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_data_export_jobs" ADD CONSTRAINT "tenant_data_export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
