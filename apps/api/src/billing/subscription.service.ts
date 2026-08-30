import { Injectable } from '@nestjs/common';
import type { BillingProviderId, Subscription, SubscriptionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';
import { isTrialExpired } from './points-errors';

export type SubscriptionView = {
  status: SubscriptionStatus;
  plan: {
    code: string;
    name: string;
    nameAr: string;
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    selfServe: boolean;
    includedPoints: number;
    officialPriceEgp: number;
    discountedPriceEgp: number;
    maxUsers: number;
    maxCompanies: number;
    isTrial: boolean;
  };
  graceEndsAt: string | null;
  entitlements: {
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    overrideActive: boolean;
  };
  accessMode: 'FULL' | 'READ_ONLY' | 'BLOCKED' | 'PENDING';
  pointsBalance: number;
  trialEndsAt: string | null;
  trialActive: boolean;
  sendBlocked: boolean;
  sendBlockedReason: 'TRIAL_ENDED' | 'INSUFFICIENT_POINTS' | null;
  extraUsers: number;
  extraCompanies: number;
};

export type AssignPlanOpts = {
  status?: SubscriptionStatus;
  provider?: BillingProviderId | null;
  providerSubscriptionId?: string | null;
  actorUserId?: string;
  reason?: string;
};

export type RecordInvoiceInput = {
  providerInvoiceId: string;
  status: string;
  amountCents: number;
  currency: string;
  hostedInvoiceUrl?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
};

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Idempotent: creates an ACTIVE Free subscription for the tenant if one doesn't already exist. */
  async ensureFreeSubscription(tenantId: string): Promise<Subscription> {
    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId } }),
    );
    if (existing) return existing;

    const freePlan = await this.prisma.plan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      throw new Error('Free plan is not seeded — run the 013 saas-layer migration first');
    }

    const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.create({
        data: { tenantId, planId: freePlan.id, status: 'ACTIVE' },
      }),
    );

    await this.audit.write({
      action: BILLING_AUDIT_ACTIONS.SUBSCRIPTION_FREE_CREATE,
      outcome: 'success',
      tenantId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: { planCode: 'FREE' },
    });

    return subscription;
  }

  async assignPlan(
    tenantId: string,
    planCode: string,
    opts: AssignPlanOpts = {},
  ): Promise<Subscription> {
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) {
      throw new Error(`Unknown plan code: ${planCode}`);
    }

    await this.ensureFreeSubscription(tenantId);

    const status = opts.status ?? 'ACTIVE';
    const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.update({
        where: { tenantId },
        data: {
          planId: plan.id,
          status,
          provider: opts.provider ?? undefined,
          providerSubscriptionId: opts.providerSubscriptionId ?? undefined,
          graceEndsAt: status === 'ACTIVE' ? null : undefined,
        },
      }),
    );

    await this.audit.write({
      action: BILLING_AUDIT_ACTIONS.PLAN_CHANGE,
      outcome: 'success',
      actorUserId: opts.actorUserId,
      tenantId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: { planCode, status, reason: opts.reason },
    });

    return subscription;
  }

  async setStatus(
    tenantId: string,
    status: SubscriptionStatus,
    opts: { graceEndsAt?: Date | null } = {},
  ): Promise<Subscription> {
    await this.ensureFreeSubscription(tenantId);
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.update({
        where: { tenantId },
        data: {
          status,
          graceEndsAt: opts.graceEndsAt === undefined ? undefined : opts.graceEndsAt,
        },
      }),
    );
  }

  async recordInvoice(tenantId: string, invoice: RecordInvoiceInput) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.invoiceRef.upsert({
        where: {
          provider_providerInvoiceId: { provider: 'stripe', providerInvoiceId: invoice.providerInvoiceId },
        },
        create: {
          tenantId,
          provider: 'stripe',
          providerInvoiceId: invoice.providerInvoiceId,
          status: invoice.status,
          amountCents: invoice.amountCents,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? undefined,
          periodStart: invoice.periodStart ?? undefined,
          periodEnd: invoice.periodEnd ?? undefined,
        },
        update: {
          status: invoice.status,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? undefined,
        },
      }),
    );
  }

  async getSubscriptionView(tenantId: string): Promise<SubscriptionView> {
    await this.ensureFreeSubscription(tenantId);

    const [subscription, tenant, override] = await Promise.all([
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
      ),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          suspendedAt: true,
          activationStatus: true,
          pointsBalance: true,
          trialEndsAt: true,
          extraUsers: true,
          extraCompanies: true,
        },
      }),
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.quotaOverride.findFirst({
          where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ]);

    const trialExpired = isTrialExpired(tenant?.trialEndsAt ?? null);
    const noPoints = (tenant?.pointsBalance ?? 0) <= 0;
    let sendBlockedReason: SubscriptionView['sendBlockedReason'] = null;
    if (trialExpired) {
      sendBlockedReason = 'TRIAL_ENDED';
    } else if (noPoints && (subscription.plan.isTrial || tenant?.trialEndsAt)) {
      sendBlockedReason = 'INSUFFICIENT_POINTS';
    } else if (noPoints) {
      const costly = await this.prisma.documentPointCost.findFirst({ where: { points: { gt: 0 } } });
      if (costly) sendBlockedReason = 'INSUFFICIENT_POINTS';
    }

    const accessMode: SubscriptionView['accessMode'] =
      tenant?.activationStatus === 'PENDING'
        ? 'PENDING'
        : tenant?.activationStatus === 'REJECTED' || tenant?.suspendedAt || subscription.status === 'SUSPENDED'
          ? 'BLOCKED'
          : subscription.status === 'READ_ONLY'
            ? 'READ_ONLY'
            : 'FULL';

    return {
      status: subscription.status,
      plan: {
        code: subscription.plan.code,
        name: subscription.plan.nameEn,
        nameAr: subscription.plan.nameAr,
        documentQuota: subscription.plan.documentQuota,
        branchQuota: subscription.plan.branchQuota,
        deviceQuota: subscription.plan.deviceQuota,
        selfServe: subscription.plan.selfServe,
        includedPoints: subscription.plan.includedPoints,
        officialPriceEgp: subscription.plan.officialPriceEgp,
        discountedPriceEgp: subscription.plan.discountedPriceEgp,
        maxUsers: subscription.plan.maxUsers,
        maxCompanies: subscription.plan.maxCompanies,
        isTrial: subscription.plan.isTrial,
      },
      graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
      entitlements: {
        documentQuota: override?.documentQuota ?? subscription.plan.documentQuota,
        branchQuota: override?.branchQuota ?? subscription.plan.branchQuota,
        deviceQuota: override?.deviceQuota ?? subscription.plan.deviceQuota,
        overrideActive: Boolean(override),
      },
      accessMode,
      pointsBalance: tenant?.pointsBalance ?? 0,
      trialEndsAt: tenant?.trialEndsAt?.toISOString() ?? null,
      trialActive: Boolean(tenant?.trialEndsAt) && !trialExpired,
      sendBlocked: sendBlockedReason !== null,
      sendBlockedReason,
      extraUsers: tenant?.extraUsers ?? 0,
      extraCompanies: tenant?.extraCompanies ?? 0,
    };
  }
}
