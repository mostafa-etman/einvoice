-- Idempotent permission catalog + system-role matrix sync.
-- NON-DESTRUCTIVE: INSERT ... ON CONFLICT DO NOTHING only.
-- Never deletes users, documents, tenants, memberships, or existing grants.
-- Custom (is_system = false) roles are not modified.

INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), v.code, v.code
FROM (
  VALUES
    ('tenant.manage'),
    ('members.view'),
    ('members.manage'),
    ('roles.view'),
    ('roles.manage'),
    ('branches.view'),
    ('branches.manage'),
    ('audit.view'),
    ('billing.view'),
    ('billing.manage'),
    ('settings.currencies.view'),
    ('settings.currencies.manage'),
    ('settings.eta.view'),
    ('settings.eta.manage'),
    ('settings.item_codes.view'),
    ('settings.item_codes.manage'),
    ('settings.numbering.view'),
    ('settings.numbering.manage'),
    ('settings.company.view'),
    ('settings.company.manage'),
    ('customers.view'),
    ('customers.manage'),
    ('documents.view'),
    ('documents.manage'),
    ('purchases.view'),
    ('purchases.manage'),
    ('devices.view'),
    ('devices.manage'),
    ('analytics.view'),
    ('analytics.export'),
    ('reports.view'),
    ('reports.export'),
    ('backup.create'),
    ('backup.schedule'),
    ('backup.download'),
    ('backup.export'),
    ('backup.restore')
) AS v(code)
ON CONFLICT (code) DO NOTHING;

-- Per-tenant GUC so FORCE RLS on roles / role_permissions is satisfied even
-- when migrate runs as table owner (non-superuser). Superusers ignore RLS.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);

    -- Owner: full catalog (lockout prevention)
    INSERT INTO role_permissions (role_id, permission_id, tenant_id)
    SELECT r.id, p.id, r.tenant_id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.tenant_id = t.id
      AND r.is_system = true
      AND r.name = 'Owner'
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Admin: catalog minus tenant.manage
    INSERT INTO role_permissions (role_id, permission_id, tenant_id)
    SELECT r.id, p.id, r.tenant_id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.tenant_id = t.id
      AND r.is_system = true
      AND r.name = 'Admin'
      AND p.code <> 'tenant.manage'
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Accountant preset (additive; does not revoke extra grants)
    INSERT INTO role_permissions (role_id, permission_id, tenant_id)
    SELECT r.id, p.id, r.tenant_id
    FROM roles r
    JOIN permissions p ON p.code IN (
      'members.view',
      'branches.view',
      'billing.view',
      'settings.currencies.view',
      'settings.item_codes.view',
      'settings.numbering.view',
      'settings.company.view',
      'customers.view',
      'customers.manage',
      'documents.view',
      'documents.manage',
      'purchases.view',
      'purchases.manage',
      'devices.view',
      'reports.view',
      'reports.export'
    )
    WHERE r.tenant_id = t.id
      AND r.is_system = true
      AND r.name = 'Accountant'
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Viewer preset
    INSERT INTO role_permissions (role_id, permission_id, tenant_id)
    SELECT r.id, p.id, r.tenant_id
    FROM roles r
    JOIN permissions p ON p.code IN (
      'members.view',
      'roles.view',
      'branches.view',
      'customers.view',
      'documents.view',
      'purchases.view'
    )
    WHERE r.tenant_id = t.id
      AND r.is_system = true
      AND r.name = 'Viewer'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END LOOP;
END $$;
