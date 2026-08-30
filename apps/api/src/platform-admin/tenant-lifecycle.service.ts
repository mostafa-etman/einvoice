import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Plan, Prisma, Subscription, SubscriptionStatus, Tenant } from '@prisma/client';
import { PasswordService } from '../auth/password.service';
import { QuotaService } from '../billing/quota.service';
import { PointsService } from '../billing/points.service';
import { SubscriptionService } from '../billing/subscription.service';
import { LimitService } from '../billing/limit.service';
import { toAddonView } from '../billing/pricing-view';
import { tenantLifecycleStatus, type TenantLifecycleStatus } from '../billing/tenant-lifecycle-status';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { PLATFORM_AUDIT_ACTIONS } from './platform-audit';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProvisionTenantInput = {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  planCode: string;
  reason?: string;
  operatorUserId: string;
};

export type AssignPlanInput = {
  planCode?: string;
  documentQuota?: number | null;
  branchQuota?: number | null;
  deviceQuota?: number | null;
  userQuota?: number | null;
  companyQuota?: number | null;
  extraUsers?: number;
  extraCompanies?: number;
  trialEndsAt?: string | null;
  reason: string;
  operatorUserId: string;
};

export type ListTenantsInput = {
  q?: string;
  status?: SubscriptionStatus;
  lifecycle?: TenantLifecycleStatus;
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
    private readonly points: PointsService,
    private readonly limits: LimitService,
  ) {}

  async listTenants(query: ListTenantsInput) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const term = query.q?.trim() ?? '';
    const where = term ? await this.tenantSearchWhere(term) : undefined;
    const rows = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = await Promise.all(
      page.map(async (tenant) => {
        const [subscription, ownerMembership] = await Promise.all([
          this.getSubscriptionWithPlan(tenant.id),
          this.tenantPrisma.withTenant(tenant.id, (tx) =>
            tx.membership.findFirst({
              where: { tenantId: tenant.id, role: { name: 'Owner' } },
              include: { user: true },
              orderBy: { createdAt: 'asc' },
            }),
          ),
        ]);
        return this.toSummary(tenant, subscription, ownerMembership?.user.email ?? null);
      }),
    );

    const filtered = items.filter((i) => {
      if (query.status && i.status !== query.status) return false;
      if (query.lifecycle && i.lifecycleStatus !== query.lifecycle) return false;
      return true;
    });

    return {
      items: filtered,
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
      ...this.toSummary(tenant, subscription, ownerMembership?.user.email ?? null),
      ownerEmail: ownerMembership?.user.email ?? null,
      ownerId: ownerMembership?.user.id ?? null,
      entitlements,
      limits: await this.limits.snapshot(tenantId).catch(() => null),
      graceEndsAt: subscription?.graceEndsAt?.toISOString() ?? null,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      extraUsers: tenant.extraUsers,
      extraCompanies: tenant.extraCompanies,
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

    const tenant = await this.tenants.createTenant(owner.id, input.name, {
      planCode: input.planCode,
      activation: 'active',
    });
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { provisionedByUserId: input.operatorUserId, approvedByUserId: input.operatorUserId },
    });

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
      const plan = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
      if (!plan) throw new BadRequestException('unknown_plan');
      await this.subscriptions.assignPlan(tenantId, input.planCode, {
        actorUserId: input.operatorUserId,
        reason: input.reason,
        status: plan.isTrial ? 'TRIAL' : 'ACTIVE',
      });
      if (!plan.isTrial) {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { trialEndsAt: null },
        });
        await this.points.grantPlanPointsIfNeeded(tenantId, input.operatorUserId);
      }
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

    const extras: { extraUsers?: number; extraCompanies?: number; trialEndsAt?: Date | null } = {};
    if (typeof input.extraUsers === 'number') extras.extraUsers = Math.max(0, Math.floor(input.extraUsers));
    if (typeof input.extraCompanies === 'number') {
      extras.extraCompanies = Math.max(0, Math.floor(input.extraCompanies));
    }
    if (input.trialEndsAt !== undefined) {
      extras.trialEndsAt = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
    }
    if (Object.keys(extras).length) {
      await this.prisma.tenant.update({ where: { id: tenantId }, data: extras });
    }

    const hasOverrideFields =
      input.documentQuota !== undefined ||
      input.branchQuota !== undefined ||
      input.deviceQuota !== undefined ||
      input.userQuota !== undefined ||
      input.companyQuota !== undefined;

    if (hasOverrideFields) {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.quotaOverride.create({
          data: {
            tenantId,
            documentQuota: input.documentQuota ?? null,
            branchQuota: input.branchQuota ?? null,
            deviceQuota: input.deviceQuota ?? null,
            userQuota: input.userQuota ?? null,
            companyQuota: input.companyQuota ?? null,
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

  async approveTenant(tenantId: string, operatorUserId: string, reason?: string) {
    const tenant = await this.assertTenantExists(tenantId);
    if (tenant.activationStatus === 'REJECTED') {
      throw new BadRequestException('cannot_approve_rejected_tenant');
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        activationStatus: 'ACTIVE',
        approvedAt: new Date(),
        approvedByUserId: operatorUserId,
        rejectedAt: null,
        rejectedReason: null,
        suspendedAt: null,
        suspendedReason: null,
      },
    });
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.updateMany({
        where: { tenantId, status: { in: ['SUSPENDED', 'READ_ONLY'] } },
        data: { status: 'ACTIVE', graceEndsAt: null },
      }),
    );
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.TENANT_APPROVE,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { reason: reason ?? null },
    });
    return this.getTenant(tenantId);
  }

  async rejectTenant(tenantId: string, operatorUserId: string, reason: string) {
    await this.assertTenantExists(tenantId);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        activationStatus: 'REJECTED',
        rejectedAt: new Date(),
        rejectedReason: reason,
      },
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.TENANT_REJECT,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { reason },
    });
    return this.getTenant(tenantId);
  }

  async getSettings() {
    return this.prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  async updateSettings(
    operatorUserId: string,
    patch: {
      autoActivateSubCompanies?: boolean;
      supportWhatsappE164?: string;
      supportWhatsappDisplay?: string;
      trialDays?: number;
      trialPoints?: number;
    },
  ) {
    const data: {
      autoActivateSubCompanies?: boolean;
      supportWhatsappE164?: string;
      supportWhatsappDisplay?: string;
      trialDays?: number;
      trialPoints?: number;
    } = {};
    if (typeof patch.autoActivateSubCompanies === 'boolean') {
      data.autoActivateSubCompanies = patch.autoActivateSubCompanies;
    }
    if (patch.supportWhatsappE164?.trim()) {
      data.supportWhatsappE164 = patch.supportWhatsappE164.replace(/\D/g, '');
    }
    if (patch.supportWhatsappDisplay?.trim()) {
      data.supportWhatsappDisplay = patch.supportWhatsappDisplay.trim();
    }
    if (typeof patch.trialDays === 'number' && Number.isFinite(patch.trialDays)) {
      data.trialDays = Math.max(1, Math.floor(patch.trialDays));
    }
    if (typeof patch.trialPoints === 'number' && Number.isFinite(patch.trialPoints)) {
      data.trialPoints = Math.max(0, Math.floor(patch.trialPoints));
    }
    const settings = await this.prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.SETTINGS_UPDATE,
      outcome: 'success',
      actorUserId: operatorUserId,
      resourceType: 'platform_settings',
      resourceId: 'default',
      metadata: data,
    });
    return settings;
  }

  async listPlans() {
    const plans = await this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    return { plans: plans.map((p) => this.toPlanAdmin(p)) };
  }

  async upsertPlan(
    operatorUserId: string,
    input: {
      code: string;
      nameEn: string;
      nameAr: string;
      descriptionEn?: string;
      descriptionAr?: string;
      documentQuota: number;
      branchQuota: number;
      deviceQuota: number;
      includedPoints: number;
      officialPriceEgp?: number;
      discountedPriceEgp?: number;
      maxUsers?: number;
      maxCompanies?: number;
      isTrial?: boolean;
      isPublic?: boolean;
      selfServe?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!code) throw new BadRequestException('plan_code_required');
    const plan = await this.prisma.plan.upsert({
      where: { code },
      create: {
        code,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        documentQuota: input.documentQuota,
        branchQuota: input.branchQuota,
        deviceQuota: input.deviceQuota,
        includedPoints: Math.max(0, Math.floor(input.includedPoints)),
        officialPriceEgp: Math.max(0, Math.floor(input.officialPriceEgp ?? 0)),
        discountedPriceEgp: Math.max(0, Math.floor(input.discountedPriceEgp ?? 0)),
        maxUsers: Math.max(1, Math.floor(input.maxUsers ?? 1)),
        maxCompanies: Math.max(1, Math.floor(input.maxCompanies ?? 1)),
        isTrial: input.isTrial ?? false,
        isPublic: input.isPublic ?? false,
        selfServe: input.selfServe ?? true,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
      update: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        documentQuota: input.documentQuota,
        branchQuota: input.branchQuota,
        deviceQuota: input.deviceQuota,
        includedPoints: Math.max(0, Math.floor(input.includedPoints)),
        officialPriceEgp:
          input.officialPriceEgp == null ? undefined : Math.max(0, Math.floor(input.officialPriceEgp)),
        discountedPriceEgp:
          input.discountedPriceEgp == null
            ? undefined
            : Math.max(0, Math.floor(input.discountedPriceEgp)),
        maxUsers: input.maxUsers == null ? undefined : Math.max(1, Math.floor(input.maxUsers)),
        maxCompanies:
          input.maxCompanies == null ? undefined : Math.max(1, Math.floor(input.maxCompanies)),
        isTrial: input.isTrial,
        isPublic: input.isPublic,
        selfServe: input.selfServe,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.PLAN_UPSERT,
      outcome: 'success',
      actorUserId: operatorUserId,
      resourceType: 'plan',
      resourceId: plan.id,
      metadata: { code: plan.code },
    });
    return this.toPlanAdmin(plan);
  }

  async getUsage(tenantId: string) {
    await this.assertTenantExists(tenantId);
    const [entitlements, usage, pointsBalance, ledger] = await Promise.all([
      this.quota.getEffectiveEntitlements(tenantId),
      this.quota.getUsage(tenantId),
      this.points.getBalance(tenantId),
      this.points.listLedger(tenantId, { limit: 20 }),
    ]);
    return {
      quotas: {
        documents: { used: usage.documents, limit: entitlements.documentQuota },
        branches: { used: usage.branches, limit: entitlements.branchQuota },
        devices: { used: usage.devices, limit: entitlements.deviceQuota },
      },
      meters: usage,
      pointsBalance,
      pointsLedger: ledger,
      limits: await this.limits.snapshot(tenantId),
    };
  }

  async listAddons() {
    const addons = await this.prisma.addon.findMany({ orderBy: { sortOrder: 'asc' } });
    return { addons: addons.map(toAddonView) };
  }

  async upsertAddon(
    operatorUserId: string,
    input: {
      code: string;
      kind: 'POINTS' | 'USER' | 'COMPANY';
      nameEn: string;
      nameAr: string;
      descriptionEn?: string;
      descriptionAr?: string;
      quantity: number;
      officialPriceEgp: number;
      discountedPriceEgp: number;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!code) throw new BadRequestException('addon_code_required');
    const addon = await this.prisma.addon.upsert({
      where: { code },
      create: {
        code,
        kind: input.kind,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        quantity: Math.max(1, Math.floor(input.quantity)),
        officialPriceEgp: Math.max(0, Math.floor(input.officialPriceEgp)),
        discountedPriceEgp: Math.max(0, Math.floor(input.discountedPriceEgp)),
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
      update: {
        kind: input.kind,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        quantity: Math.max(1, Math.floor(input.quantity)),
        officialPriceEgp: Math.max(0, Math.floor(input.officialPriceEgp)),
        discountedPriceEgp: Math.max(0, Math.floor(input.discountedPriceEgp)),
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.ADDON_UPSERT,
      outcome: 'success',
      actorUserId: operatorUserId,
      resourceType: 'addon',
      resourceId: addon.id,
      metadata: { code: addon.code },
    });
    return toAddonView(addon);
  }

  async applyAddon(tenantId: string, addonCode: string, operatorUserId: string, reason: string) {
    await this.assertTenantExists(tenantId);
    const addon = await this.prisma.addon.findUnique({ where: { code: addonCode.trim().toUpperCase() } });
    if (!addon || !addon.isActive) throw new BadRequestException('unknown_addon');

    if (addon.kind === 'POINTS') {
      await this.points.adjustBalance(tenantId, addon.quantity, operatorUserId, reason || addon.code);
    } else if (addon.kind === 'USER') {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { extraUsers: { increment: addon.quantity } },
      });
    } else if (addon.kind === 'COMPANY') {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { extraCompanies: { increment: addon.quantity } },
      });
    }

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.ADDON_APPLY,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'addon',
      resourceId: addon.id,
      metadata: { addonCode: addon.code, kind: addon.kind, quantity: addon.quantity, reason },
    });
    return this.getTenant(tenantId);
  }

  private async tenantSearchWhere(term: string): Promise<Prisma.TenantWhereInput> {
    const ids = new Set<string>();
    if (UUID_RE.test(term)) {
      ids.add(term);
    }

    if (!UUID_RE.test(term)) {
      const emailUsers = await this.prisma.user.findMany({
        where: { email: { contains: term, mode: 'insensitive' } },
        select: { id: true },
        take: 25,
      });
      for (const user of emailUsers) {
        const memberships = await this.tenantPrisma.withUser(user.id, (tx) =>
          tx.membership.findMany({
            where: { userId: user.id },
            select: { tenantId: true },
          }),
        );
        for (const m of memberships) {
          ids.add(m.tenantId);
        }
      }
    }

    const or: Prisma.TenantWhereInput[] = [
      { name: { contains: term, mode: 'insensitive' } },
    ];
    if (ids.size) {
      or.push({ id: { in: [...ids] } });
    }
    return { OR: or };
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

  private toSummary(
    tenant: Tenant,
    subscription: SubscriptionWithPlan | null,
    ownerEmail: string | null = null,
  ) {
    return {
      id: tenant.id,
      name: tenant.name,
      planCode: subscription?.plan.code ?? null,
      status: subscription?.status ?? null,
      lifecycleStatus: tenantLifecycleStatus(tenant),
      activationStatus: tenant.activationStatus,
      suspendedAt: tenant.suspendedAt,
      pointsBalance: tenant.pointsBalance,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      extraUsers: tenant.extraUsers,
      extraCompanies: tenant.extraCompanies,
      createdAt: tenant.createdAt.toISOString(),
      ownerEmail,
    };
  }

  private toPlanAdmin(plan: Plan) {
    return {
      id: plan.id,
      code: plan.code,
      nameEn: plan.nameEn,
      nameAr: plan.nameAr,
      descriptionEn: plan.descriptionEn,
      descriptionAr: plan.descriptionAr,
      documentQuota: plan.documentQuota,
      branchQuota: plan.branchQuota,
      deviceQuota: plan.deviceQuota,
      includedPoints: plan.includedPoints,
      officialPriceEgp: plan.officialPriceEgp,
      discountedPriceEgp: plan.discountedPriceEgp,
      maxUsers: plan.maxUsers,
      maxCompanies: plan.maxCompanies,
      isTrial: plan.isTrial,
      isPublic: plan.isPublic,
      selfServe: plan.selfServe,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    };
  }
}
