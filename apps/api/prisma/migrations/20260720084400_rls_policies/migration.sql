-- Tenant-scoped RLS. GUCs: app.tenant_id, app.user_id (SET LOCAL via set_config(..., true))

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_branches ON branches;
CREATE POLICY tenant_isolation_branches ON branches
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_roles ON roles;
CREATE POLICY tenant_isolation_roles ON roles
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.tenant_id = roles.tenant_id
        AND m.user_id::text = NULLIF(current_setting('app.user_id', true), '')
    )
  )
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_role_permissions ON role_permissions;
CREATE POLICY tenant_isolation_role_permissions ON role_permissions
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships;
CREATE POLICY tenant_isolation_memberships ON memberships
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR (
      NULLIF(current_setting('app.tenant_id', true), '') IS NULL
      AND user_id::text = NULLIF(current_setting('app.user_id', true), '')
    )
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  );

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (
    tenant_id IS NULL
    OR tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
  );
