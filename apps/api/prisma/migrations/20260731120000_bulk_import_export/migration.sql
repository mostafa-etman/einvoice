-- Bulk import / export tables (009)
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'MAPPING', 'VALIDATING', 'VALIDATED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'CREATED', 'SIGN_ENQUEUED', 'FAILED');
CREATE TYPE "ImportRunMode" AS ENUM ('CREATE_ONLY', 'CREATE_SIGN_SUBMIT');
CREATE TYPE "ExportJobKind" AS ENUM ('LOCAL', 'ETA_PACKAGE');
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');
CREATE TYPE "EtaPackageLocalStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'READY', 'ERROR', 'DELETED', 'STALLED');

CREATE TABLE "import_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "document_type" TEXT NOT NULL,
  "document_type_version" TEXT,
  "branch_id" UUID,
  "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
  "run_mode" "ImportRunMode",
  "source_file_name" TEXT NOT NULL,
  "source_content_type" TEXT NOT NULL,
  "source_byte_size" INTEGER NOT NULL,
  "source_checksum" TEXT NOT NULL,
  "source_object_key" TEXT NOT NULL,
  "mapping_json" JSONB,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "valid_rows" INTEGER NOT NULL DEFAULT 0,
  "invalid_rows" INTEGER NOT NULL DEFAULT 0,
  "created_docs" INTEGER NOT NULL DEFAULT 0,
  "sign_enqueued" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "processed_rows" INTEGER NOT NULL DEFAULT 0,
  "error_report_object_key" TEXT,
  "error_summary" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_row_results" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "import_job_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "business_key" TEXT,
  "status" "ImportRowStatus" NOT NULL,
  "errors_json" JSONB NOT NULL DEFAULT '[]',
  "document_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_row_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "kind" "ExportJobKind" NOT NULL,
  "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "filters_json" JSONB NOT NULL,
  "formats_json" JSONB NOT NULL DEFAULT '[]',
  "artifact_object_keys_json" JSONB,
  "expires_at" TIMESTAMP(3),
  "error_summary" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eta_package_requests" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "export_job_id" UUID NOT NULL,
  "eta_request_id" TEXT NOT NULL,
  "local_status" "EtaPackageLocalStatus" NOT NULL DEFAULT 'REQUESTED',
  "eta_status_raw" INTEGER,
  "request_payload_json" JSONB NOT NULL,
  "package_object_key" TEXT,
  "package_byte_size" INTEGER,
  "last_polled_at" TIMESTAMP(3),
  "ready_at" TIMESTAMP(3),
  "error_summary" TEXT,
  "notification_accelerated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "eta_package_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "import_job_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "import_row_number" INTEGER;

CREATE INDEX "import_jobs_tenant_id_created_at_idx" ON "import_jobs"("tenant_id", "created_at");
CREATE INDEX "import_jobs_tenant_id_status_idx" ON "import_jobs"("tenant_id", "status");
CREATE UNIQUE INDEX "import_row_results_import_job_id_row_number_key" ON "import_row_results"("import_job_id", "row_number");
CREATE INDEX "import_row_results_tenant_id_import_job_id_status_idx" ON "import_row_results"("tenant_id", "import_job_id", "status");
CREATE INDEX "export_jobs_tenant_id_created_at_idx" ON "export_jobs"("tenant_id", "created_at");
CREATE INDEX "export_jobs_tenant_id_kind_status_idx" ON "export_jobs"("tenant_id", "kind", "status");
CREATE UNIQUE INDEX "eta_package_requests_export_job_id_key" ON "eta_package_requests"("export_job_id");
CREATE UNIQUE INDEX "eta_package_requests_tenant_id_eta_request_id_key" ON "eta_package_requests"("tenant_id", "eta_request_id");
CREATE INDEX "eta_package_requests_tenant_id_local_status_idx" ON "eta_package_requests"("tenant_id", "local_status");
CREATE INDEX "documents_tenant_id_import_job_id_idx" ON "documents"("tenant_id", "import_job_id");

ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eta_package_requests" ADD CONSTRAINT "eta_package_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eta_package_requests" ADD CONSTRAINT "eta_package_requests_export_job_id_fkey" FOREIGN KEY ("export_job_id") REFERENCES "export_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
