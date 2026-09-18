-- Platform-admin payments list must join Account → Subscription → Plan in one
-- query. Tenant HTTP still sets app.tenant_id, so companies only see their
-- own subscription. Unscoped PrismaService (GUC unset) matches accounts RLS.

DROP POLICY IF EXISTS tenant_isolation_subscriptions ON subscriptions;
CREATE POLICY tenant_isolation_subscriptions ON subscriptions
  USING (
    account_id IN (
      SELECT t.account_id FROM tenants t
      WHERE t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  )
  WITH CHECK (
    account_id IN (
      SELECT t.account_id FROM tenants t
      WHERE t.id::text = NULLIF(current_setting('app.tenant_id', true), '')
    )
    OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
