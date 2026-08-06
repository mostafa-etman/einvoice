-- Impersonation sessions: FORCE RLS; tenant context or platform_operator GUC.

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_impersonation_sessions ON impersonation_sessions;
CREATE POLICY tenant_isolation_impersonation_sessions ON impersonation_sessions
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_operator', true), '') = '1'
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_operator', true), '') = '1'
  );
