import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PlanCode, QuotaOverride } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QuotaExceededError, QuotaExceededHttpException, type QuotaResource } from './quota-errors';
import { cairoMonthBounds, cairoMonthDateStrings, CAIRO_TZ } from './quota-period';
import { TenantAccessService } from './tenant-access.guard';

export type Entitlements = {
  planCode: PlanCode;
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

type PlanQuotas = { code: PlanCode; documentQuota: number; branchQuota: number; deviceQuota: number };
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
  ) {}

  /** Effective entitlements = Plan (+ latest non-expired QuotaOverride). Falls back to Free plan quotas pre-subscription. */
  async getEffectiveEntitlements(tenantId: string): Promise<Entitlements> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });

      const plan = subscription?.plan ?? (await this.prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } }));

      const override = await tx.quotaOverride.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      return mergeEntitlements(plan, override);
    });
  }

  /** Documents = analytics `issued` for the Africa/Cairo calendar month; branches = active; devices = PAIRED. */
  async getUsage(tenantId: string, now: Date = new Date()): Promise<UsageSnapshot> {
    const { from, to, monthKey } = cairoMonthBounds(now);
    const { fromDate, toDate } = cairoMonthDateStrings(now);

    const [summary, branches, devices] = await Promise.all([
      this.analytics.getSummary({ tenantId, from: fromDate, to: toDate }),
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.branch.count({ where: { tenantId, isActive: true } }),
      ),
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.signingDevice.count({ where: { tenantId, status: 'PAIRED' } }),
      ),
    ]);

    return {
      period: { from, to, monthKey, timezone: CAIRO_TZ },
      documents: summary.totals.issued ?? 0,
      branches,
      devices,
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
      throw new QuotaExceededHttpException(new QuotaExceededError(resource, used, limit));
    }
  }

  /** Throws when the tenant is suspended or its subscription is READ_ONLY / SUSPENDED. Read paths are unaffected. */
  async checkTenantWritable(tenantId: string): Promise<void> {
    const result = await this.tenantAccess.isWriteAllowed(tenantId);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason);
    }
  }
}
