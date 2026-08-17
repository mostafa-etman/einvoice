import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  isSystemOwnerRole,
  type PermissionCode,
} from '@einvoice/shared';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService, type TenantTx } from '../prisma/tenant-prisma.service';
import {
  assertCanCreateRoleName,
  assertCanDeleteRole,
  assertCanRenameRole,
  assertKnownPermissionCodes,
  assertLastOwnerPreserved,
  assertLastRolesManagePreserved,
  assertNoPrivilegeEscalation,
  permissionsToPersist,
} from './role-policy';

export type RoleDto = {
  id: string;
  name: string;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
};

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<RoleDto[]> {
    const roles = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.role.findMany({
        where: { tenantId },
        include: {
          rolePermissions: { include: { permission: true } },
          _count: { select: { memberships: true } },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      memberCount: r._count.memberships,
      permissions: r.rolePermissions.map((rp) => rp.permission.code),
    }));
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: { name: string; permissions?: string[] },
  ): Promise<RoleDto> {
    const name = assertCanCreateRoleName(input.name);
    const requested = assertKnownPermissionCodes(input.permissions ?? []);
    const actor = await this.loadActor(tenantId, actorUserId);
    assertNoPrivilegeEscalation(actor.codes, requested);

    try {
      const created = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const role = await tx.role.create({
          data: { tenantId, name, isSystem: false },
        });
        await this.replacePermissions(tx, tenantId, role.id, requested);
        return this.loadRoleDto(tx, tenantId, role.id);
      });
      await this.audit.write({
        action: 'roles.create',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'role',
        resourceId: created.id,
      });
      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A role with this name already exists');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    roleId: string,
    input: { name?: string; permissions?: string[] },
  ): Promise<RoleDto> {
    const actor = await this.loadActor(tenantId, actorUserId);

    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: roleId, tenantId },
        include: { rolePermissions: { include: { permission: true } } },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }

      if (input.name !== undefined && input.name.trim() !== role.name) {
        assertCanRenameRole(role, input.name);
        try {
          await tx.role.update({
            where: { id: role.id },
            data: { name: input.name.trim() },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new BadRequestException('A role with this name already exists');
          }
          throw err;
        }
      }

      if (input.permissions) {
        const requested = assertKnownPermissionCodes(input.permissions);
        const persisted = permissionsToPersist(role, requested);
        assertNoPrivilegeEscalation(actor.codes, persisted);
        if (isSystemOwnerRole(role)) {
          await this.replacePermissions(tx, tenantId, role.id, [...ALL_PERMISSION_CODES]);
        } else {
          await this.assertRolesManageSurvives(tx, tenantId, {
            roleId: role.id,
            nextCodes: persisted,
          });
          await this.replacePermissions(tx, tenantId, role.id, persisted);
        }
      }

      return this.loadRoleDto(tx, tenantId, role.id);
    });

    await this.audit.write({
      action: 'roles.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'role',
      resourceId: roleId,
    });
    return updated;
  }

  async remove(
    tenantId: string,
    actorUserId: string,
    roleId: string,
    reassignToRoleId?: string,
  ): Promise<void> {
    const actor = await this.loadActor(tenantId, actorUserId);

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: roleId, tenantId },
        include: { _count: { select: { memberships: true } } },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }
      assertCanDeleteRole(role, role._count.memberships, reassignToRoleId);

      if (role._count.memberships > 0) {
        if (!reassignToRoleId || reassignToRoleId === role.id) {
          throw new BadRequestException('Reassign members to a different role');
        }
        const target = await tx.role.findFirst({
          where: { id: reassignToRoleId, tenantId },
          include: { rolePermissions: { include: { permission: true } } },
        });
        if (!target) {
          throw new BadRequestException('Reassign target role not found in this tenant');
        }
        const targetCodes = target.rolePermissions.map((rp) => rp.permission.code);
        assertNoPrivilegeEscalation(actor.codes, targetCodes);
        assertLastOwnerPreserved({
          currentIsSystemOwner: isSystemOwnerRole(role),
          ownerMemberCount: await this.countSystemOwners(tx, tenantId),
          movingAwayFromOwner: !isSystemOwnerRole(target),
        });
        await tx.membership.updateMany({
          where: { tenantId, roleId: role.id },
          data: { roleId: target.id },
        });
        await this.assertRolesManageSurvives(tx, tenantId, {});
      }

      await tx.role.delete({ where: { id: role.id } });
    });

    await this.audit.write({
      action: 'roles.delete',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'role',
      resourceId: roleId,
    });
  }

  async updateMemberRole(
    tenantId: string,
    actorUserId: string,
    membershipId: string,
    roleId: string,
  ) {
    const actor = await this.loadActor(tenantId, actorUserId);

    const membership = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        include: { role: true },
      });
      if (!existing) {
        throw new NotFoundException('Membership not found');
      }
      const target = await tx.role.findFirst({
        where: { id: roleId, tenantId },
        include: { rolePermissions: { include: { permission: true } } },
      });
      if (!target) {
        throw new BadRequestException('Role not found in this tenant');
      }
      const targetCodes = target.rolePermissions.map((rp) => rp.permission.code);
      assertNoPrivilegeEscalation(actor.codes, targetCodes);
      assertLastOwnerPreserved({
        currentIsSystemOwner: isSystemOwnerRole(existing.role),
        ownerMemberCount: await this.countSystemOwners(tx, tenantId),
        movingAwayFromOwner: !isSystemOwnerRole(target),
      });

      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: { roleId },
        include: { user: true, role: true },
      });
      await this.assertRolesManageSurvives(tx, tenantId, {});
      return updated;
    });

    await this.audit.write({
      action: 'members.role.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceId: membershipId,
    });
    return membership;
  }

  private async loadActor(tenantId: string, actorUserId: string) {
    const membership = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: actorUserId } },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
      }),
    );
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    const codes = new Set(
      membership.role.rolePermissions.map((rp) => rp.permission.code),
    );
    return { membership, codes };
  }

  private async loadRoleDto(tx: TenantTx, tenantId: string, roleId: string): Promise<RoleDto> {
    const role = await tx.role.findFirst({
      where: { id: roleId, tenantId },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { memberships: true } },
      },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return {
      id: role.id,
      name: role.name,
      isSystem: role.isSystem,
      memberCount: role._count.memberships,
      permissions: role.rolePermissions.map((rp) => rp.permission.code),
    };
  }

  private async replacePermissions(
    tx: TenantTx,
    tenantId: string,
    roleId: string,
    codes: PermissionCode[],
  ) {
    const permissions = await tx.permission.findMany({
      where: { code: { in: codes } },
    });
    const desiredIds = new Set(permissions.map((p) => p.id));
    const existing = await tx.rolePermission.findMany({
      where: { roleId, tenantId },
    });
    const existingIds = new Set(existing.map((e) => e.permissionId));
    const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
    const toRemove = existing
      .filter((e) => !desiredIds.has(e.permissionId))
      .map((e) => e.permissionId);

    if (toAdd.length) {
      await tx.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ tenantId, roleId, permissionId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length) {
      await tx.rolePermission.deleteMany({
        where: { roleId, tenantId, permissionId: { in: toRemove } },
      });
    }
  }

  private async countSystemOwners(tx: TenantTx, tenantId: string) {
    return tx.membership.count({
      where: { tenantId, role: { isSystem: true, name: 'Owner' } },
    });
  }

  private async assertRolesManageSurvives(
    tx: TenantTx,
    tenantId: string,
    opts: { roleId?: string; nextCodes?: PermissionCode[] },
  ) {
    const holders = await tx.membership.findMany({
      where: { tenantId },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });
    const remaining = holders.filter((m) => {
      const codes =
        opts.roleId && m.roleId === opts.roleId && opts.nextCodes
          ? opts.nextCodes
          : m.role.rolePermissions.map((rp) => rp.permission.code);
      return codes.includes(PERMISSIONS.ROLES_MANAGE);
    }).length;
    assertLastRolesManagePreserved({ remainingHolders: remaining });
  }
}
