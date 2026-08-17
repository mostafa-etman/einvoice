import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ALL_PERMISSION_CODES,
  isReservedRoleName,
  isSystemOwnerRole,
  type PermissionCode,
} from '@einvoice/shared';

export function assertKnownPermissionCodes(codes: string[]): PermissionCode[] {
  const catalog = new Set<string>(ALL_PERMISSION_CODES);
  const unique: PermissionCode[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    if (!catalog.has(code)) {
      throw new BadRequestException(`Unknown permission: ${code}`);
    }
    if (seen.has(code)) continue;
    seen.add(code);
    unique.push(code as PermissionCode);
  }
  return unique;
}

/** Actor may only grant (or assign a role that contains) permissions they hold. */
export function assertNoPrivilegeEscalation(
  actorCodes: ReadonlySet<string>,
  granted: readonly string[],
) {
  const extra = granted.filter((code) => !actorCodes.has(code));
  if (extra.length > 0) {
    throw new ForbiddenException(
      `Cannot grant permissions beyond your own: ${extra.join(', ')}`,
    );
  }
}

export function assertCanRenameRole(
  role: { isSystem: boolean },
  newName: string,
) {
  if (role.isSystem) {
    throw new BadRequestException('Cannot rename a default role');
  }
  const trimmed = newName.trim();
  if (!trimmed) {
    throw new BadRequestException('Role name is required');
  }
  if (isReservedRoleName(trimmed)) {
    throw new BadRequestException('Name is reserved for a default role');
  }
}

export function assertCanCreateRoleName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BadRequestException('Role name is required');
  }
  if (trimmed.length > 80) {
    throw new BadRequestException('Role name is too long');
  }
  if (isReservedRoleName(trimmed)) {
    throw new BadRequestException('Name is reserved for a default role');
  }
  return trimmed;
}

export function assertCanDeleteRole(
  role: { isSystem: boolean },
  memberCount: number,
  reassignToRoleId?: string,
) {
  if (role.isSystem) {
    throw new BadRequestException('Cannot delete a default role');
  }
  if (memberCount > 0 && !reassignToRoleId) {
    throw new ConflictException(
      'Reassign members before deleting this role',
    );
  }
}

export function assertLastOwnerPreserved(params: {
  currentIsSystemOwner: boolean;
  ownerMemberCount: number;
  movingAwayFromOwner: boolean;
}) {
  if (
    params.currentIsSystemOwner &&
    params.movingAwayFromOwner &&
    params.ownerMemberCount <= 1
  ) {
    throw new ForbiddenException('Cannot remove the last Owner');
  }
}

export function assertLastRolesManagePreserved(params: {
  remainingHolders: number;
}) {
  if (params.remainingHolders < 1) {
    throw new ForbiddenException(
      'At least one member must keep roles.manage',
    );
  }
}

export function permissionsToPersist(
  role: { name: string; isSystem: boolean },
  requested: PermissionCode[],
): PermissionCode[] {
  if (isSystemOwnerRole(role)) {
    return [...ALL_PERMISSION_CODES];
  }
  return requested;
}
