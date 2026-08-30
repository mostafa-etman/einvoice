-- Official offer: 5 paid packages, trial, add-ons, user/company limits.
-- Existing tenants are remapped to a paid plan (never TRIAL) so live customers stay active.

ALTER TYPE "PointsLedgerReason" ADD VALUE IF NOT EXISTS 'TRIAL_GRANT';

CREATE TYPE "AddonKind" AS ENUM ('POINTS', 'USER', 'COMPANY');

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extra_users INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_companies INT NOT NULL DEFAULT 0;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS official_price_egp INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_price_egp INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_users INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_companies INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS trial_points INT NOT NULL DEFAULT 30;

ALTER TABLE document_point_costs
  ADD COLUMN IF NOT EXISTS standard_points INT NOT NULL DEFAULT 0;

ALTER TABLE quota_overrides
  ADD COLUMN IF NOT EXISTS user_quota INT,
  ADD COLUMN IF NOT EXISTS company_quota INT;

CREATE TABLE addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  kind "AddonKind" NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description_en TEXT,
  description_ar TEXT,
  quantity INT NOT NULL,
  official_price_egp INT NOT NULL,
  discounted_price_egp INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy catalog stays assignable for tests / admin, but is hidden from customer cards.
UPDATE plans SET
  is_public = false,
  is_trial = false,
  max_users = CASE code
    WHEN 'FREE' THEN 50
    WHEN 'STARTER' THEN 10
    WHEN 'PRO' THEN 20
    ELSE 100
  END,
  max_companies = CASE code
    WHEN 'FREE' THEN 50
    WHEN 'STARTER' THEN 10
    WHEN 'PRO' THEN 20
    ELSE 100
  END
WHERE code IN ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

INSERT INTO plans (
  id, code, name_en, name_ar, description_en, description_ar,
  document_quota, branch_quota, device_quota, included_points,
  official_price_egp, discounted_price_egp, max_users, max_companies,
  is_trial, is_public, self_serve, is_active, sort_order
) VALUES
  (gen_random_uuid(), 'TRIAL', 'Trial', 'تجريبية',
   '7-day free trial', 'فترة تجريبية مجانية 7 أيام',
   10000, 1, 1, 0, 0, 0, 1, 1, true, false, false, true, 0),
  (gen_random_uuid(), 'BASIC', 'Basic', 'الأساسية',
   'Annual package', 'باقة سنوية',
   500, 1, 1, 500, 400, 250, 1, 1, false, true, true, true, 10),
  (gen_random_uuid(), 'BRONZE', 'Bronze', 'البرونزية',
   'Annual package', 'باقة سنوية',
   4500, 10, 3, 4500, 850, 550, 3, 10, false, true, true, true, 20),
  (gen_random_uuid(), 'SILVER', 'Silver', 'الفضية',
   'Annual package', 'باقة سنوية',
   10000, 25, 5, 10000, 1500, 950, 5, 25, false, true, true, true, 30),
  (gen_random_uuid(), 'GOLD', 'Gold', 'الذهبية',
   'Annual package', 'باقة سنوية',
   18000, 50, 7, 18000, 2250, 1450, 7, 50, false, true, true, true, 40),
  (gen_random_uuid(), 'PLATINUM', 'Platinum', 'البلاتينية',
   'Annual package', 'باقة سنوية',
   30000, 100, 10, 30000, 3500, 2250, 10, 100, false, true, true, true, 50)
ON CONFLICT (code) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_ar = EXCLUDED.name_ar,
  description_en = EXCLUDED.description_en,
  description_ar = EXCLUDED.description_ar,
  document_quota = EXCLUDED.document_quota,
  branch_quota = EXCLUDED.branch_quota,
  device_quota = EXCLUDED.device_quota,
  included_points = EXCLUDED.included_points,
  official_price_egp = EXCLUDED.official_price_egp,
  discounted_price_egp = EXCLUDED.discounted_price_egp,
  max_users = EXCLUDED.max_users,
  max_companies = EXCLUDED.max_companies,
  is_trial = EXCLUDED.is_trial,
  is_public = EXCLUDED.is_public,
  self_serve = EXCLUDED.self_serve,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO addons (
  code, kind, name_en, name_ar, description_en, description_ar,
  quantity, official_price_egp, discounted_price_egp, is_active, sort_order
) VALUES
  ('POINTS_4500', 'POINTS', 'Points pack 4,500', 'باقة 4,500 نقطة',
   'Valid until the end of the current subscription', 'صالحة حتى نهاية الاشتراك الحالي',
   4500, 450, 300, true, 10),
  ('EXTRA_USER', 'USER', 'Extra user', 'مستخدم إضافي',
   'Per extra user / year', 'لكل مستخدم إضافي / سنوياً',
   1, 120, 75, true, 20),
  ('EXTRA_COMPANY', 'COMPANY', 'Extra company', 'شركة إضافية',
   'Per extra company / year', 'لكل شركة إضافية / سنوياً',
   1, 100, 50, true, 30)
ON CONFLICT (code) DO UPDATE SET
  kind = EXCLUDED.kind,
  name_en = EXCLUDED.name_en,
  name_ar = EXCLUDED.name_ar,
  description_en = EXCLUDED.description_en,
  description_ar = EXCLUDED.description_ar,
  quantity = EXCLUDED.quantity,
  official_price_egp = EXCLUDED.official_price_egp,
  discounted_price_egp = EXCLUDED.discounted_price_egp,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Promo costs charged now; standard kept for admin display / later switch.
UPDATE document_point_costs SET points = 3, standard_points = 4
WHERE document_kind IN (
  'INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE',
  'EXPORT_INVOICE', 'EXPORT_CREDIT_NOTE', 'EXPORT_DEBIT_NOTE'
);
UPDATE document_point_costs SET points = 1, standard_points = 1
WHERE document_kind = 'RECEIPT';

INSERT INTO document_point_costs (document_kind, points, standard_points)
VALUES
  ('INVOICE', 3, 4),
  ('CREDIT_NOTE', 3, 4),
  ('DEBIT_NOTE', 3, 4),
  ('EXPORT_INVOICE', 3, 4),
  ('EXPORT_CREDIT_NOTE', 3, 4),
  ('EXPORT_DEBIT_NOTE', 3, 4),
  ('RECEIPT', 1, 1)
ON CONFLICT (document_kind) DO UPDATE SET
  points = EXCLUDED.points,
  standard_points = EXCLUDED.standard_points,
  updated_at = now();

UPDATE platform_settings SET
  trial_days = COALESCE(NULLIF(trial_days, 0), 7),
  trial_points = COALESCE(NULLIF(trial_points, 0), 30)
WHERE id = 'default';

-- Existing customers: paid mapping, no trial clock. Do not grant extra points.
UPDATE subscriptions s
SET plan_id = target.id,
    status = 'ACTIVE',
    updated_at = now()
FROM plans old
JOIN plans target ON target.code = CASE old.code
  WHEN 'FREE' THEN 'BASIC'
  WHEN 'STARTER' THEN 'BRONZE'
  WHEN 'PRO' THEN 'GOLD'
  WHEN 'ENTERPRISE' THEN 'PLATINUM'
END
WHERE s.plan_id = old.id
  AND old.code IN ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

UPDATE tenants SET trial_ends_at = NULL
WHERE trial_ends_at IS NOT NULL
  AND id IN (
    SELECT s.tenant_id
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE p.is_trial = false
  );

-- Don't lock out the live customer: if a remapped ACTIVE tenant has no points
-- and never received a grant, credit the new plan's included points.
WITH granted AS (
  UPDATE tenants t
  SET points_balance = t.points_balance + p.included_points,
      updated_at = now()
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
  WHERE s.tenant_id = t.id
    AND t.activation_status = 'ACTIVE'
    AND t.suspended_at IS NULL
    AND t.points_balance = 0
    AND p.included_points > 0
    AND p.is_trial = false
    AND NOT EXISTS (
      SELECT 1 FROM points_ledger pl
      WHERE pl.tenant_id = t.id AND pl.reason::text = 'PLAN_GRANT'
    )
  RETURNING t.id, p.included_points AS delta, t.points_balance
)
INSERT INTO points_ledger (tenant_id, delta, balance_after, reason, note)
SELECT id, delta, points_balance, 'PLAN_GRANT', 'migrate:offer-pricing'
FROM granted;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO einvoice_app;
