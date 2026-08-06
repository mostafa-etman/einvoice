import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Plan, PlanCode, Subscription, SubscriptionStatus, Tenant } from '@prisma/client';
import { PasswordService } from '../auth/password.service';
import { QuotaService } from '../billing/quota.service';
import { SubscriptionService } from '../billing/subscription.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { PLATFORM_AUDIT_ACTIONS } from './platform-audit';

export type ProvisionTenantInput = {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  planCode: PlanCode;
  reason?: string;
  operatorUserId: string;
};

export type AssignPlanInput = {
  planCode?: PlanCode;
  documentQuota?: number | null;
  branchQuota?: number | null;
  deviceQuota?: number | null;
  reason: string;
  operatorUserId: string;
};

export type ListTenantsInput = {
  q?: string;
  status?: SubscriptionStatus;
  cursor?: string;
  limit?: number;
};

type SubscriptionWithPlan = Subscription & { plan: Plan };

/**
 * Cross-tenant reads happen tenant-by-tenant via `TenantPrismaService.withTenant`
 * (the app DB role has FORCE RLS with no bypass) — never a single unscoped query
 * across `Subscription` / `QuotaOverride` (research.md R5 — "no silent cross-tenant reads").
 */
@Injectable()
export class TenantLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantService,
    private readonly subscriptions: SubscriptionService,
    private readonly quota: QuotaService,
    private readonly passwords: PasswordService,
  ) {}

  async listTenants(query: ListTenantsInput) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = await this.prisma.tenant.findMany({
      where: query.q ? { name: { contains: query.q, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'asc' },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = await Promise.all(
      page.map(async (tenant) => {
        const subscription = await this.getSubscriptionWithPlan(tenant.id);
        return this.toSummary(tenant, subscription);
      }),
    );

    return {
      items: query.status ? items.filter((i) => i.status === query.status) : items,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('tenant_not_found');
    }
    const [subscription, entitlements, ownerMembership] = await Promise.all([
      this.getSubscriptionWithPlan(tenantId),
      this.quota.getEffectiveEntitlements(tenantId),
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.membership.findFirst({
          where: { tenantId, role: { name: 'Owner' } },
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        }),
      ),
    ]);

    return {
      ...this.toSummary(tenant, subscription),
      ownerEmail: ownerMembership?.user.email ?? null,
      ownerId: ownerMembership?.user.id ?? null,
      entitlements,
      graceEndsAt: subscription?.graceEndsAt?.toISOString() ?? null,
    };
  }

  async provisionTenant(input: ProvisionTenantInput) {
    const email = input.ownerEmail.trim().toLowerCase();
    let owner = await this.prisma.user.findUnique({ where: { email } });
    if (!owner) {
      const passwordHash = await this.passwords.hash(randomBytes(24).toString('hex'));
      owner = await this.prisma.user.create({
        data: { email, passwordHash, name: input.ownerName },
      });
    }

    const tenant = await this.tenants.createTenant(owner.id, input.name);
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { provisionedByUserId: input.operatorUserId },
    });

    if (input.planCode !== 'FREE') {
      await this.subscriptions.assignPlan(tenant.id, input.planCode, {
        actorUserId: input.operatorUserId,
        reason: input.reason ?? 'platform_provision',
      });
    }

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.TENANT_PROVISION,
      outcome: 'success',
      actorUserId: input.operatorUserId,
      tenantId: tenant.id,
      resourceType: 'tenant',
      resourceId: tenant.id,
      metadata: { ownerEmail: email, planCode: input.planCode, reason: input.reason ?? null },
    });

    return this.getTenant(tenant.id);
  }

  async suspendTenant(tenantId: string, reason: string, operatorUserId: string) {
    await this.assertTenantExists(tenantId);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: new Date(), suspendedReason: reason },
    });
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.updateMany({ where: { tenantId }, data: { status: 'SUSPENDED' } }),
    );

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.TENANT_SUSPEND,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { reason },
    });

    return this.getTenant(tenantId);
  }

  async activateTenant(tenantId: string, operatorUserId: string, reason?: string) {
    await this.assertTenantExists(tenantId);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: null, suspendedReason: null },
    });
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.updateMany({
        where: { tenantId, status: 'SUSPENDED' },
        data: { status: 'ACTIVE', graceEndsAt: null },
      }),
    );

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.TENANT_ACTIVATE,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { reason: reason ?? null },
    });

    return this.getTenant(tenantId);
  }

  /** Plan assign and quota override are audited separately (T061) — override always carries before/after. */
  async assignPlan(tenantId: string, input: AssignPlanInput) {
    await this.assertTenantExists(tenantId);
    const before = await this.quota.getEffectiveEntitlements(tenantId);

    if (input.planCode) {
      await this.subscriptions.assignPlan(tenantId, input.planCode, {
        actorUserId: input.operatorUserId,
        reason: input.reason,
      });
      await this.audit.write({
        action: PLATFORM_AUDIT_ACTIONS.PLAN_ASSIGN,
        outcome: 'success',
        actorUserId: input.operatorUserId,
        tenantId,
        resourceType: 'subscription',
        resourceId: tenantId,
        metadata: { planCode: input.planCode, reason: input.reason },
      });
    }

    const hasOverrideFields =
      input.documentQuota !== undefined ||
      input.branchQuota !== undefined ||
      input.deviceQuota !== undefined;

    if (hasOverrideFields) {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.quotaOverride.create({
          data: {
            tenantId,
            documentQuota: input.documentQuota ?? null,
            branchQuota: input.branchQuota ?? null,
            deviceQuota: input.deviceQuota ?? null,
            reason: input.reason,
            createdByUserId: input.operatorUserId,
          },
        }),
      );
      const after = await this.quota.getEffectiveEntitlements(tenantId);
      await this.audit.write({
        action: PLATFORM_AUDIT_ACTIONS.QUOTA_OVERRIDE,
        outcome: 'success',
        actorUserId: input.operatorUserId,
        tenantId,
        resourceType: 'quota_override',
        resourceId: tenantId,
        metadata: { before, after, reason: input.reason },
      });
    }

    return this.getTenant(tenantId);
  }

  async getUsage(tenantId: string) {
    await this.assertTenantExists(tenantId);
    const [entitlements, usage] = await Promise.all([
      this.quota.getEffectiveEntitlements(tenantId),
      this.quota.getUsage(tenantId),
    ]);
    return {
      quotas: {
        documents: { used: usage.documents, limit: entitlements.documentQuota },
        branches: { used: usage.branches, limit: entitlements.branchQuota },
        devices: { used: usage.devices, limit: entitlements.deviceQuota },
      },
      meters: usage,
    };
  }

  private async assertTenantExists(tenantId: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('tenant_not_found');
    }
    return tenant;
  }

  private getSubscriptionWithPlan(tenantId: string): Promise<SubscriptionWithPlan | null> {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    );
  }

  private toSummary(tenant: Tenant, subscription: SubscriptionWithPlan | null) {
    return {
      id: tenant.id,
      name: tenant.name,
      planCode: subscription?.plan.code ?? null,
      status: subscription?.status ?? null,
      suspendedAt: tenant.suspendedAt,
    };
  }
}
