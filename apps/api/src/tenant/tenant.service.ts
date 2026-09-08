import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_PERMISSION_CODES,
  DEFAULT_ROLE_NAMES,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  type PermissionCode,
} from '@einvoice/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionService } from '../billing/subscription.service';
import { PointsService } from '../billing/points.service';
import { LimitService } from '../billing/limit.service';
import { TrialTaxRegistrationService } from '../billing/trial-tax-registration.service';
import { isTrialAlreadyUsedException } from '../billing/trial-errors';
import { loadEnv } from '../config/env';
import { tenantLifecycleStatus } from '../billing/tenant-lifecycle-status';
import { assertNoPrivilegeEscalation } from '../rbac/role-policy';

@Injectable()
export class TenantService implements OnModuleInit {
  private readonly log = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    // BillingModule <-> TenantModule is circular (billing controllers need
    // PermissionsGuard from TenantModule; onboarding needs a Free subscription
    // here) — forwardRef on both module and constructor param breaks the cycle.
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptions: SubscriptionService,
    @Inject(forwardRef(() => PointsService))
    private readonly points: PointsService,
    @Inject(forwardRef(() => LimitService))
    private readonly limits: LimitService,
    @Inject(forwardRef(() => TrialTaxRegistrationService))
    private readonly trialTax: TrialTaxRegistrationService,
  ) {}

  async onModuleInit() {
    try {
      // Catalog upsert is cheap; role-matrix sync can be large — run it in the
      // background so Nest can listen immediately.
      await this.ensurePermissionCatalog();
      void this.syncSystemRolePermissions().catch((err) =>
        this.log.warn(
          `Role permission sync failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    } catch (err) {
      this.log.warn(
        `Permission catalog sync skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

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

  /**
   * Idempotent, additive: grants ROLE_PERMISSION_MATRIX codes missing on
   * system roles. Never deletes role_permissions, memberships, or tenant data.
   *
   * Must run inside `withTenant` — einvoice_app cannot see RLS-forced `roles`
   * / `role_permissions` without `app.tenant_id`.
   */
  async syncSystemRolePermissions() {
    await this.ensurePermissionCatalog();
    const permissions = await this.prisma.permission.findMany();
    const byCode = new Map(permissions.map((p) => [p.code, p.id]));
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let granted = 0;
    for (const tenant of tenants) {
      granted += await this.syncTenantSystemRolePermissions(tenant.id, byCode);
    }
    this.log.log(
      `Role permission sync: ${tenants.length} tenant(s), ${granted} row(s) granted`,
    );
  }

  async syncTenantSystemRolePermissions(
    tenantId: string,
    byCode?: Map<string, string>,
  ) {
    const permissionByCode =
      byCode ??
      new Map((await this.prisma.permission.findMany()).map((p) => [p.code, p.id]));
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const roles = await tx.role.findMany({
        where: { tenantId, isSystem: true, name: { in: [...DEFAULT_ROLE_NAMES] } },
        select: { id: true, name: true },
      });
      const rows: Array<{ tenantId: string; roleId: string; permissionId: string }> =
        [];
      for (const role of roles) {
        const matrix =
          role.name === 'Owner'
            ? ALL_PERMISSION_CODES
            : ROLE_PERMISSION_MATRIX[role.name as (typeof DEFAULT_ROLE_NAMES)[number]];
        if (!matrix) continue;
        for (const code of matrix) {
          const permissionId = permissionByCode.get(code);
          if (!permissionId) continue;
          rows.push({ tenantId, roleId: role.id, permissionId });
        }
      }
      if (!rows.length) return 0;
      const result = await tx.rolePermission.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return result.count;
    });
  }

  async createTenant(
    userId: string,
    name: string,
    opts: {
      planCode?: string;
      activation?: 'pending' | 'active';
      taxRegistrationNumber?: string;
    } = {},
  ) {
    await this.ensurePermissionCatalog();
    const permissions = await this.prisma.permission.findMany();
    const byCode = new Map(permissions.map((p) => [p.code, p.id]));
    const ownerCount = await this.countOwnerTenants(userId);
    const isFirst = ownerCount === 0;
    const autoApprove = loadEnv().SIGNUP_AUTO_APPROVE;
    const startTrial =
      isFirst && !autoApprove && opts.activation !== 'active' && opts.activation !== 'pending';

    if (!isFirst && opts.activation !== 'active') {
      await this.limits.assertCanCreateCompany(userId);
    }

    const activationStatus = startTrial
      ? 'ACTIVE'
      : await this.resolveActivationStatus(userId, opts.activation);

    const planCode = opts.planCode?.trim();
    if (planCode && !startTrial) {
      const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
      if (!plan || !plan.isActive) {
        throw new BadRequestException('unknown_plan');
      }
    }

    if (startTrial) {
      await this.trialTax.assertAvailable(opts.taxRegistrationNumber);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name,
          activationStatus,
          approvedAt: activationStatus === 'ACTIVE' ? new Date() : null,
          approvedByUserId:
            activationStatus === 'ACTIVE' && opts.activation === 'active' ? userId : null,
        },
      });
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

    if (startTrial) {
      try {
        await this.startSelfServeTrial(result.tenant.id, userId, opts.taxRegistrationNumber);
      } catch (err) {
        if (isTrialAlreadyUsedException(err)) {
          await this.subscriptions.ensureFreeSubscription(result.tenant.id);
        }
        throw err;
      }
    } else {
      await this.subscriptions.ensureFreeSubscription(result.tenant.id);
      if (planCode && planCode !== 'FREE') {
        await this.subscriptions.assignPlan(result.tenant.id, planCode, {
          actorUserId: userId,
          reason: 'signup_plan',
        });
      } else if (!isFirst && opts.activation !== 'active') {
        const parentPlan = await this.primaryOwnerPlanCode(userId, result.tenant.id);
        if (parentPlan && parentPlan !== 'FREE' && parentPlan !== 'TRIAL') {
          await this.subscriptions.assignPlan(result.tenant.id, parentPlan, {
            actorUserId: userId,
            reason: 'sub_company_inherit',
          });
        }
      }
      if (isFirst || opts.activation === 'active') {
        await this.points.grantPlanPointsIfNeeded(result.tenant.id, userId);
      }
    }

    await this.audit.write({
      action: 'tenant.create.success',
      outcome: 'success',
      actorUserId: userId,
      tenantId: result.tenant.id,
      resourceType: 'tenant',
      resourceId: result.tenant.id,
      metadata: {
        activationStatus,
        planCode: startTrial ? 'TRIAL' : (planCode ?? 'FREE'),
        trial: startTrial,
      },
    });

    return this.prisma.tenant.findUniqueOrThrow({ where: { id: result.tenant.id } });
  }

  /**
   * Platform provision passes activation: 'active'. Tests use SIGNUP_AUTO_APPROVE.
   * Sub-companies of an ACTIVE owner stay auto-active when autoActivateSubCompanies is on.
   * First self-serve signup (production) is handled as an ACTIVE trial in createTenant.
   */
  private async resolveActivationStatus(
    userId: string,
    forced?: 'pending' | 'active',
  ): Promise<'PENDING' | 'ACTIVE'> {
    if (forced === 'active') return 'ACTIVE';
    if (forced === 'pending') return 'PENDING';
    if (loadEnv().SIGNUP_AUTO_APPROVE) return 'ACTIVE';

    const settings = await this.prisma.platformSettings.findUnique({ where: { id: 'default' } });
    const autoSub = settings?.autoActivateSubCompanies ?? true;
    if (!autoSub) return 'PENDING';

    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, role: { name: 'Owner' } },
        select: { tenantId: true },
      }),
    );
    if (!memberships.length) return 'PENDING';

    const parents = await this.prisma.tenant.findMany({
      where: { id: { in: memberships.map((m) => m.tenantId) } },
      select: { activationStatus: true, suspendedAt: true },
    });
    const trusted = parents.some((p) => tenantLifecycleStatus(p) === 'ACTIVE');
    return trusted ? 'ACTIVE' : 'PENDING';
  }

  private async countOwnerTenants(userId: string): Promise<number> {
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, role: { name: 'Owner' } },
        select: { tenantId: true },
      }),
    );
    return memberships.length;
  }

  private async primaryOwnerPlanCode(
    userId: string,
    excludeTenantId: string,
  ): Promise<string | null> {
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, role: { name: 'Owner' } },
        select: { tenantId: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    for (const m of memberships) {
      if (m.tenantId === excludeTenantId) continue;
      const sub = await this.tenantPrisma.withTenant(m.tenantId, (tx) =>
        tx.subscription.findUnique({ where: { tenantId: m.tenantId }, include: { plan: true } }),
      );
      if (sub?.plan.code) return sub.plan.code;
    }
    return null;
  }

  private async startSelfServeTrial(
    tenantId: string,
    userId: string,
    taxRegistrationNumber?: string,
  ) {
    await this.trialTax.consume(taxRegistrationNumber, tenantId);
    const settings = await this.prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    const days = Math.max(1, settings.trialDays || 7);
    const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.subscriptions.assignPlan(tenantId, 'TRIAL', {
      actorUserId: userId,
      reason: 'signup_trial',
      status: 'TRIAL',
    });
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { trialEndsAt, extraUsers: 0, extraCompanies: 0 },
    });
    await this.points.grantTrialPointsIfNeeded(tenantId, userId);
  }

  async listMyTenants(userId: string) {
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId },
        include: { tenant: true, role: true },
      }),
    );
    return memberships.map((m) => ({
      tenant: {
        id: m.tenant.id,
        name: m.tenant.name,
        activationStatus: m.tenant.activationStatus,
        suspendedAt: m.tenant.suspendedAt,
        pointsBalance: m.tenant.pointsBalance,
        trialEndsAt: m.tenant.trialEndsAt?.toISOString() ?? null,
        lifecycleStatus: tenantLifecycleStatus(m.tenant),
      },
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
      tx.branch.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  listRoles(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.role.findMany({
        where: { tenantId },
        include: {
          rolePermissions: { include: { permission: true } },
          _count: { select: { memberships: true } },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  listMembers(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.findMany({
        where: { tenantId },
        include: { user: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async addMember(tenantId: string, actorUserId: string, email: string, roleId: string) {
    await this.limits.assertCanAddMember(tenantId);
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    try {
      const membership = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const role = await tx.role.findFirst({
          where: { id: roleId, tenantId },
          include: { rolePermissions: { include: { permission: true } } },
        });
        if (!role) {
          throw new BadRequestException('Role not found in this tenant');
        }
        const actor = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId: actorUserId } },
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        });
        if (!actor) {
          throw new NotFoundException('Membership not found');
        }
        assertNoPrivilegeEscalation(
          new Set(actor.role.rolePermissions.map((rp) => rp.permission.code)),
          role.rolePermissions.map((rp) => rp.permission.code),
        );
        return tx.membership.create({
          data: { tenantId, userId: user.id, roleId },
          include: { user: true, role: true },
        });
      });
      await this.audit.write({
        action: 'members.add.success',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceId: membership.id,
      });
      return membership;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('User is already a member of this company');
      }
      throw err;
    }
  }

}
