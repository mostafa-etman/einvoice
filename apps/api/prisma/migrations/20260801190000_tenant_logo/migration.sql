-- Per-tenant company logo (MinIO object key + metadata).
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "logo_object_key" TEXT,
  ADD COLUMN IF NOT EXISTS "logo_content_type" TEXT,
  ADD COLUMN IF NOT EXISTS "logo_byte_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "logo_updated_at" TIMESTAMP(3);
