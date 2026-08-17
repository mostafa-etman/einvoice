import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  isSystemOwnerRole,
} from '@einvoice/shared';
import {
  assertCanCreateRoleName,
  assertCanDeleteRole,
  assertLastOwnerPreserved,
  assertNoPrivilegeEscalation,
  permissionsToPersist,
} from './role-policy';

describe('role policy', () => {
  it('blocks granting a permission the actor does not have', () => {
    expect(() =>
      assertNoPrivilegeEscalation(new Set([PERMISSIONS.DOCUMENTS_VIEW]), [
        PERMISSIONS.DOCUMENTS_VIEW,
        PERMISSIONS.ROLES_MANAGE,
      ]),
    ).toThrow(/beyond your own/);
  });

  it('allows granting a subset of the actor permissions', () => {
    expect(() =>
      assertNoPrivilegeEscalation(
        new Set([PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.ROLES_MANAGE]),
        [PERMISSIONS.DOCUMENTS_VIEW],
      ),
    ).not.toThrow();
  });

  it('rejects reserved custom role names', () => {
    expect(() => assertCanCreateRoleName('Owner')).toThrow(/reserved/);
    expect(() => assertCanCreateRoleName('admin')).toThrow(/reserved/);
    expect(assertCanCreateRoleName('Sales')).toBe('Sales');
  });

  it('blocks deleting a default role and deleting a role with members', () => {
    expect(() =>
      assertCanDeleteRole({ isSystem: true }, 0),
    ).toThrow(/default role/);
    expect(() =>
      assertCanDeleteRole({ isSystem: false }, 2),
    ).toThrow(/Reassign members/);
    expect(() =>
      assertCanDeleteRole({ isSystem: false }, 2, 'other-role'),
    ).not.toThrow();
  });

  it('blocks removing the last Owner membership', () => {
    expect(() =>
      assertLastOwnerPreserved({
        currentIsSystemOwner: true,
        ownerMemberCount: 1,
        movingAwayFromOwner: true,
      }),
    ).toThrow(/last Owner/);
  });

  it('forces Owner to keep the full catalog', () => {
    const owner = { name: 'Owner', isSystem: true };
    expect(isSystemOwnerRole(owner)).toBe(true);
    expect(permissionsToPersist(owner, [PERMISSIONS.DOCUMENTS_VIEW])).toEqual(
      ALL_PERMISSION_CODES,
    );
  });
});
