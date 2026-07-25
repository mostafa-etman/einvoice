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

  it('Accountant has billing.manage but not members.manage', () => {
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.BILLING_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Accountant).not.toContain(PERMISSIONS.MEMBERS_MANAGE);
  });

  it('PermissionsGuard is defined', () => {
    expect(PermissionsGuard).toBeDefined();
  });
});
