import { Injectable } from '@nestjs/common';
import type { BillingProviderId, PlanCode, Subscription, SubscriptionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';

export type SubscriptionView = {
  status: SubscriptionStatus;
  plan: {
    code: PlanCode;
    name: string;
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    selfServe: boolean;
  };
  graceEndsAt: string | null;
  entitlements: {
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    overrideActive: boolean;
  };
  accessMode: 'FULL' | 'READ_ONLY' | 'BLOCKED';
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
    planCode: PlanCode,
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
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { suspendedAt: true } }),
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.quotaOverride.findFirst({
          where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ]);

    const accessMode: SubscriptionView['accessMode'] =
      tenant?.suspendedAt || subscription.status === 'SUSPENDED'
        ? 'BLOCKED'
        : subscription.status === 'READ_ONLY'
          ? 'READ_ONLY'
          : 'FULL';

    return {
      status: subscription.status,
      plan: {
        code: subscription.plan.code,
        name: subscription.plan.nameEn,
        documentQuota: subscription.plan.documentQuota,
        branchQuota: subscription.plan.branchQuota,
        deviceQuota: subscription.plan.deviceQuota,
        selfServe: subscription.plan.selfServe,
      },
      graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
      entitlements: {
        documentQuota: override?.documentQuota ?? subscription.plan.documentQuota,
        branchQuota: override?.branchQuota ?? subscription.plan.branchQuota,
        deviceQuota: override?.deviceQuota ?? subscription.plan.deviceQuota,
        overrideActive: Boolean(override),
      },
      accessMode,
    };
  }
}
