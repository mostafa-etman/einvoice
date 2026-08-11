-- Per-session active company (nullable: existing sessions keep working).
ALTER TABLE "refresh_sessions"
  ADD COLUMN "active_tenant_id" UUID;

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_active_tenant_id_fkey"
  FOREIGN KEY ("active_tenant_id") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "refresh_sessions_active_tenant_id_idx"
  ON "refresh_sessions"("active_tenant_id");
