import { PERMISSIONS, ROLE_PERMISSION_MATRIX } from '@einvoice/shared';
import { PermissionsGuard } from './permissions.guard';

describe('RBAC permission matrix', () => {
  it('Owner has members.manage and tenant.manage', () => {
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain(PERMISSIONS.MEMBERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain(PERMISSIONS.TENANT_MANAGE);
  });

  it('Viewer lacks members.manage but has documents.view', () => {
    expect(ROLE_PERMISSION_MATRIX.Viewer).not.toContain(PERMISSIONS.MEMBERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Viewer).toContain(PERMISSIONS.DOCUMENTS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Viewer).not.toContain(PERMISSIONS.DOCUMENTS_MANAGE);
  });

  it('Accountant can view billing but not manage the subscription', () => {
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.BILLING_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Accountant).not.toContain(PERMISSIONS.BILLING_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Accountant).not.toContain(PERMISSIONS.MEMBERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Accountant).not.toContain(PERMISSIONS.ANALYTICS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.REPORTS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.REPORTS_EXPORT);
  });

  it('Owner and Admin own billing.manage', () => {
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain(PERMISSIONS.BILLING_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.BILLING_MANAGE);
  });

  it('Admin has analytics.view and analytics.export', () => {
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.ANALYTICS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.ANALYTICS_EXPORT);
  });

  it('Owner/Admin/Accountant include customers and purchases', () => {
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain(PERMISSIONS.PURCHASES_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.PURCHASES_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Viewer).toContain(PERMISSIONS.PURCHASES_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Viewer).not.toContain(PERMISSIONS.PURCHASES_MANAGE);
  });

  it('PermissionsGuard is defined', () => {
    expect(PermissionsGuard).toBeDefined();
  });
});
