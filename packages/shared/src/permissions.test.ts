import {
  ALL_PERMISSION_CODES,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  isReservedRoleName,
  isSystemOwnerRole,
} from './permissions.js';

describe('permission catalog', () => {
  it('groups cover every catalog code exactly once', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.codes);
    expect([...grouped].sort()).toEqual([...ALL_PERMISSION_CODES].sort());
    expect(new Set(grouped).size).toBe(ALL_PERMISSION_CODES.length);
  });

  it('includes customers and purchases permissions', () => {
    expect(ALL_PERMISSION_CODES).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(ALL_PERMISSION_CODES).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(ALL_PERMISSION_CODES).toContain(PERMISSIONS.PURCHASES_VIEW);
    expect(ALL_PERMISSION_CODES).toContain(PERMISSIONS.PURCHASES_MANAGE);
  });

  it('Owner preset is the full catalog', () => {
    expect([...ROLE_PERMISSION_MATRIX.Owner].sort()).toEqual(
      [...ALL_PERMISSION_CODES].sort(),
    );
  });

  it('Admin gets new catalog codes except tenant.manage', () => {
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.PURCHASES_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Admin).not.toContain(PERMISSIONS.TENANT_MANAGE);
  });

  it('Accountant can manage customers and purchases but not roles', () => {
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Accountant).toContain(PERMISSIONS.PURCHASES_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Accountant).not.toContain(PERMISSIONS.ROLES_MANAGE);
  });

  it('reserves default role names case-insensitively', () => {
    expect(isReservedRoleName('owner')).toBe(true);
    expect(isReservedRoleName(' Admin ')).toBe(true);
    expect(isReservedRoleName('Sales')).toBe(false);
  });

  it('identifies the system Owner role', () => {
    expect(isSystemOwnerRole({ name: 'Owner', isSystem: true })).toBe(true);
    expect(isSystemOwnerRole({ name: 'Owner', isSystem: false })).toBe(false);
    expect(isSystemOwnerRole({ name: 'Admin', isSystem: true })).toBe(false);
  });
});
