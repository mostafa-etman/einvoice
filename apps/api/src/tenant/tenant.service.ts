import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ROLE_NAMES,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  type PermissionCode,
} from '@einvoice/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async ensurePermissionCatalog() {
    const codes = Object.values(PERMISSIONS);
    for (const code of codes) {
      await this.prisma.permission.upsert({
        where: { code },
        create: { code, description: code },
        update: {},
      });
    }
  }

  async createTenant(userId: string, name: string) {
    await this.ensurePermissionCatalog();
    const permissions = await this.prisma.permission.findMany();
    const byCode = new Map(permissions.map((p) => [p.code, p.id]));

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name } });
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: 'Main', isDefault: true },
      });

      const roles: Record<string, string> = {};
      for (const roleName of DEFAULT_ROLE_NAMES) {
        const role = await tx.role.create({
          data: { tenantId: tenant.id, name: roleName, isSystem: true },
        });
        roles[roleName] = role.id;
        const codes = ROLE_PERMISSION_MATRIX[roleName];
        for (const code of codes) {
          const permissionId = byCode.get(code);
          if (!permissionId) continue;
          await tx.rolePermission.create({
            data: {
              tenantId: tenant.id,
              roleId: role.id,
              permissionId,
            },
          });
        }
      }

      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId,
          roleId: roles.Owner,
        },
      });

      return { tenant, branch, membership, roles };
    });

    await this.audit.write({
      action: 'tenant.create.success',
      outcome: 'success',
      actorUserId: userId,
      tenantId: result.tenant.id,
      resourceType: 'tenant',
      resourceId: result.tenant.id,
    });

    return result.tenant;
  }

  async listMyTenants(userId: string) {
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId },
        include: { tenant: true, role: true },
      }),
    );
    return memberships.map((m) => ({
      tenant: { id: m.tenant.id, name: m.tenant.name },
      role: { id: m.role.id, name: m.role.name },
    }));
  }

  async getMembership(userId: string, tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
        },
      }),
    );
  }

  async userHasPermission(
    userId: string,
    tenantId: string,
    code: PermissionCode,
  ): Promise<boolean> {
    const membership = await this.getMembership(userId, tenantId);
    if (!membership) return false;
    return membership.role.rolePermissions.some((rp) => rp.permission.code === code);
  }

  listBranches(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.branch.findMany({ orderBy: { createdAt: 'asc' } }),
    );
  }

  listRoles(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.role.findMany({
        include: { rolePermissions: { include: { permission: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  listMembers(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.findMany({
        include: { user: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async addMember(tenantId: string, actorUserId: string, email: string, roleId: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      throw new Error('User not found');
    }
    const membership = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.create({
        data: { tenantId, userId: user.id, roleId },
        include: { user: true, role: true },
      }),
    );
    await this.audit.write({
      action: 'members.add.success',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceId: membership.id,
    });
    return membership;
  }

  async updateMemberRole(
    tenantId: string,
    actorUserId: string,
    membershipId: string,
    roleId: string,
  ) {
    const membership = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.update({
        where: { id: membershipId },
        data: { roleId },
        include: { user: true, role: true },
      }),
    );
    await this.audit.write({
      action: 'members.role.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceId: membershipId,
    });
    return membership;
  }
}
