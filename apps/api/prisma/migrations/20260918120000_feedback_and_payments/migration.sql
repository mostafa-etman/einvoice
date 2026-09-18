-- Tenant-admin per-screen feedback + manual account payments ledger.
-- Additive only: existing accounts keep amount_due_egp = 0 and due_date NULL
-- (they will not show as overdue until an operator sets billing).

CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWED', 'RESOLVED');
CREATE TYPE "PaymentPurpose" AS ENUM ('PLAN', 'RENEWAL', 'POINTS_TOPUP', 'ADDON', 'OTHER');

ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "amount_due_egp" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(3);

CREATE TABLE "tenant_screen_feedback" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tenant_name_snapshot" TEXT NOT NULL,
  "author_user_id" UUID NOT NULL,
  "author_email_snapshot" TEXT NOT NULL,
  "author_name_snapshot" TEXT,
  "screen_key" TEXT NOT NULL,
  "route_path" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_screen_feedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tenant_screen_feedback"
  ADD CONSTRAINT "tenant_screen_feedback_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_screen_feedback"
  ADD CONSTRAINT "tenant_screen_feedback_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_screen_feedback"
  ADD CONSTRAINT "tenant_screen_feedback_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tenant_screen_feedback_tenant_id_created_at_idx"
  ON "tenant_screen_feedback" ("tenant_id", "created_at");
CREATE INDEX "tenant_screen_feedback_status_created_at_idx"
  ON "tenant_screen_feedback" ("status", "created_at");
CREATE INDEX "tenant_screen_feedback_screen_key_idx"
  ON "tenant_screen_feedback" ("screen_key");

CREATE TABLE "account_payments" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "amount_egp" INT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "paid_at" TIMESTAMP(3) NOT NULL,
  "purpose" "PaymentPurpose" NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "account_payments"
  ADD CONSTRAINT "account_payments_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_payments"
  ADD CONSTRAINT "account_payments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "account_payments_account_id_paid_at_idx"
  ON "account_payments" ("account_id", "paid_at");

-- Tenant-admin screen feedback: a tenant session may SELECT/INSERT only its own
-- rows. Status updates are platform-operator (unscoped PrismaService / GUC unset).
ALTER TABLE tenant_screen_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_screen_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_screen_feedback_select ON tenant_screen_feedback;
CREATE POLICY tenant_isolation_tenant_screen_feedback_select ON tenant_screen_feedback
  FOR SELECT
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
DROP POLICY IF EXISTS tenant_isolation_tenant_screen_feedback_insert ON tenant_screen_feedback;
CREATE POLICY tenant_isolation_tenant_screen_feedback_insert ON tenant_screen_feedback
  FOR INSERT
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  );
DROP POLICY IF EXISTS tenant_isolation_tenant_screen_feedback_update ON tenant_screen_feedback;
CREATE POLICY tenant_isolation_tenant_screen_feedback_update ON tenant_screen_feedback
  FOR UPDATE
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
DROP POLICY IF EXISTS tenant_isolation_tenant_screen_feedback_delete ON tenant_screen_feedback;
CREATE POLICY tenant_isolation_tenant_screen_feedback_delete ON tenant_screen_feedback
  FOR DELETE
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL);

-- Manual payments ledger is platform-operator only. Tenant sessions
-- (app.tenant_id set) cannot see or write rows.
ALTER TABLE account_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only_account_payments ON account_payments;
CREATE POLICY platform_only_account_payments ON account_payments
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
