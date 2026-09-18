import { ForbiddenException, Inject, Injectable, forwardRef } from '@nestjs/common';
import type { QuotaOverride } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QuotaExceededError, QuotaExceededHttpException, type QuotaResource } from './quota-errors';
import { cairoMonthBounds, cairoMonthDateStrings, CAIRO_TZ } from './quota-period';
import { TenantAccessService } from './tenant-access.guard';
import { loadAccountBilling, requireTenantAccount } from './account-scope';
import { PointsService } from './points.service';

export type Entitlements = {
  planCode: string;
  documentQuota: number;
  branchQuota: number;
  deviceQuota: number;
  overrideActive: boolean;
};

export type UsageSnapshot = {
  period: { from: Date; to: Date; monthKey: string; timezone: string };
  documents: number;
  branches: number;
  devices: number;
};

export type CompanyMeters = {
  documents: number;
  branches: number;
  devices: number;
};

type PlanQuotas = { code: string; documentQuota: number; branchQuota: number; deviceQuota: number };
type OverrideQuotas = Pick<
  QuotaOverride,
  'documentQuota' | 'branchQuota' | 'deviceQuota' | 'expiresAt'
> | null;

/** Pure merge of plan defaults + an (optional, possibly expired) override — exported for unit testing. */
export function mergeEntitlements(
  plan: PlanQuotas,
  override: OverrideQuotas,
  now: Date = new Date(),
): Entitlements {
  const active = Boolean(override) && (!override!.expiresAt || override!.expiresAt.getTime() > now.getTime());
  return {
    planCode: plan.code,
    documentQuota: active && override!.documentQuota != null ? override!.documentQuota : plan.documentQuota,
    branchQuota: active && override!.branchQuota != null ? override!.branchQuota : plan.branchQuota,
    deviceQuota: active && override!.deviceQuota != null ? override!.deviceQuota : plan.deviceQuota,
    overrideActive: active,
  };
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly analytics: AnalyticsService,
    private readonly tenantAccess: TenantAccessService,
    @Inject(forwardRef(() => PointsService))
    private readonly points: PointsService,
  ) {}

  /**
   * Effective entitlements = Plan + account extras for branches/devices
   * (+ latest non-expired QuotaOverride). Documents stay per-company.
   * Falls back to Free plan quotas pre-subscription.
   */
  async getEffectiveEntitlements(tenantId: string): Promise<Entitlements> {
    const { account } = await loadAccountBilling(this.prisma, tenantId);
    const { accountId } = await requireTenantAccount(this.prisma, tenantId);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { accountId },
        include: { plan: true },
      });

      const plan = subscription?.plan ?? (await this.prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } }));

      const tenantOverride = await tx.quotaOverride.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      const accountBdOverride = await this.accountBranchDeviceOverride(accountId);

      const documents = mergeEntitlements(plan, tenantOverride);
      const pooledPlan: PlanQuotas = {
        code: plan.code,
        documentQuota: plan.documentQuota,
        branchQuota: Math.max(0, plan.branchQuota) + Math.max(0, account.extraBranches),
        deviceQuota: Math.max(0, plan.deviceQuota) + Math.max(0, account.extraDevices),
      };
      const pooled = mergeEntitlements(pooledPlan, accountBdOverride);

      return {
        planCode: plan.code,
        documentQuota: documents.documentQuota,
        branchQuota: pooled.branchQuota,
        deviceQuota: pooled.deviceQuota,
        overrideActive: documents.overrideActive || pooled.overrideActive,
      };
    });
  }

  /** Per-company meters (documents this Cairo month; this company's active branches / paired devices). */
  async getCompanyMeters(tenantId: string, now: Date = new Date()): Promise<CompanyMeters> {
    const { fromDate, toDate } = cairoMonthDateStrings(now);
    const [summary, local] = await Promise.all([
      this.analytics.getSummary({ tenantId, from: fromDate, to: toDate }),
      this.countTenantBranchesDevices(tenantId),
    ]);
    return {
      documents: summary.totals.issued ?? 0,
      branches: local.branches,
      devices: local.devices,
    };
  }

  /**
   * Documents = this company's analytics `issued` for the Africa/Cairo calendar month.
   * Branches / devices = ACCOUNT-wide active branches / PAIRED devices.
   */
  async getUsage(tenantId: string, now: Date = new Date()): Promise<UsageSnapshot> {
    const { accountId } = await requireTenantAccount(this.prisma, tenantId);
    const { from, to, monthKey } = cairoMonthBounds(now);
    const meters = await this.getCompanyMeters(tenantId, now);
    const pooled = await this.countAccountBranchesDevices(accountId);

    return {
      period: { from, to, monthKey, timezone: CAIRO_TZ },
      documents: meters.documents,
      branches: pooled.branches,
      devices: pooled.devices,
    };
  }

  async getQuotaSnapshot(tenantId: string) {
    const [entitlements, usage] = await Promise.all([
      this.getEffectiveEntitlements(tenantId),
      this.getUsage(tenantId),
    ]);
    return {
      period: {
        timezone: usage.period.timezone,
        monthStart: usage.period.from.toISOString(),
        monthEnd: usage.period.to.toISOString(),
      },
      documents: { used: usage.documents, limit: entitlements.documentQuota },
      branches: { used: usage.branches, limit: entitlements.branchQuota },
      devices: { used: usage.devices, limit: entitlements.deviceQuota },
      entitlements,
    };
  }

  /** `used >= limit` blocks the NEXT resource (issued+1 > limit / branches+1 > limit / devices+1 > limit). */
  async assertWithinLimits(tenantId: string, resource: QuotaResource): Promise<void> {
    const [entitlements, usage] = await Promise.all([
      this.getEffectiveEntitlements(tenantId),
      this.getUsage(tenantId),
    ]);

    const limit =
      resource === 'documents'
        ? entitlements.documentQuota
        : resource === 'branches'
          ? entitlements.branchQuota
          : entitlements.deviceQuota;
    const used =
      resource === 'documents' ? usage.documents : resource === 'branches' ? usage.branches : usage.devices;

    if (used >= limit) {
      const contact = await this.points.getSupportContact();
      throw new QuotaExceededHttpException(
        new QuotaExceededError(resource, used, limit, contact.whatsappUrl, contact.whatsappDisplay),
      );
    }
  }

  /** Throws when the tenant is suspended or its subscription is READ_ONLY / SUSPENDED. Read paths are unaffected. */
  async checkTenantWritable(tenantId: string): Promise<void> {
    const result = await this.tenantAccess.isWriteAllowed(tenantId);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason);
    }
  }

  async countTenantBranchesDevices(tenantId: string): Promise<{ branches: number; devices: number }> {
    const [branches, deviceSlot] = await Promise.all([
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.branch.count({ where: { tenantId, isActive: true } }),
      ),
      this.countTenantDeviceSlots(tenantId),
    ]);
    return { branches, devices: deviceSlot };
  }

  /**
   * Paired signing agents + active POS devices that are not linked to a paired
   * agent share one account-pooled device quota (same physical till = one slot).
   */
  async countTenantDeviceSlots(tenantId: string): Promise<number> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [paired, activePos] = await Promise.all([
        tx.signingDevice.findMany({
          where: { tenantId, status: 'PAIRED' },
          select: { id: true },
        }),
        tx.posDevice.findMany({
          where: { tenantId, status: 'ACTIVE' },
          select: { signingDeviceId: true },
        }),
      ]);
      const pairedIds = new Set(paired.map((d) => d.id));
      const extraPos = activePos.filter(
        (p) => !p.signingDeviceId || !pairedIds.has(p.signingDeviceId),
      ).length;
      return paired.length + extraPos;
    });
  }

  /** True when this POS can share the device slot of an already-paired signing agent. */
  async posSharesSigningSlot(
    tenantId: string,
    signingDeviceId: string | null | undefined,
  ): Promise<boolean> {
    if (!signingDeviceId) return false;
    const device = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.signingDevice.findFirst({
        where: { id: signingDeviceId, tenantId, status: 'PAIRED' },
        select: { id: true },
      }),
    );
    return Boolean(device);
  }

  async countAccountBranchesDevices(accountId: string): Promise<{ branches: number; devices: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { accountId },
      select: { id: true },
    });
    let branches = 0;
    let devices = 0;
    for (const tenant of tenants) {
      const local = await this.countTenantBranchesDevices(tenant.id);
      branches += local.branches;
      devices += local.devices;
    }
    return { branches, devices };
  }

  private async accountBranchDeviceOverride(accountId: string): Promise<OverrideQuotas> {
    const tenants = await this.prisma.tenant.findMany({
      where: { accountId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    let latest: OverrideQuotas = null;
    let latestAt = 0;
    for (const tenant of tenants) {
      const override = await this.tenantPrisma.withTenant(tenant.id, (tx) =>
        tx.quotaOverride.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' },
        }),
      );
      if (!override) continue;
      if (override.branchQuota == null && override.deviceQuota == null) continue;
      const at = override.createdAt.getTime();
      if (at >= latestAt) {
        latestAt = at;
        latest = override;
      }
    }
    return latest;
  }
}
