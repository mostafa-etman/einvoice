import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';
import { PointsService } from './points.service';
import { QuotaService } from './quota.service';
import { SubscriptionService } from './subscription.service';
import { LimitService } from './limit.service';
import { toAddonView, toPlanView } from './pricing-view';

export type StartCheckoutInput = {
  planCode: string;
  successUrl?: string;
  cancelUrl?: string;
};

export type ManualCheckoutResult = {
  mode: 'manual';
  planCode: string;
  planName: string;
  planNameAr: string;
  whatsappUrl: string;
  whatsappDisplay: string;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly subscriptions: SubscriptionService,
    private readonly points: PointsService,
    private readonly limits: LimitService,
  ) {}

  async invoicePromoPoints(): Promise<number> {
    const row = await this.prisma.documentPointCost.findUnique({ where: { documentKind: 'INVOICE' } });
    return row?.points ?? 3;
  }

  async listPlans() {
    const invoicePoints = await this.invoicePromoPoints();
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { sortOrder: 'asc' },
    });
    return { plans: plans.map((plan) => toPlanView(plan, invoicePoints)) };
  }

  async getCatalog() {
    const [invoice, receipt, settings, plans, addons] = await Promise.all([
      this.prisma.documentPointCost.findUnique({ where: { documentKind: 'INVOICE' } }),
      this.prisma.documentPointCost.findUnique({ where: { documentKind: 'RECEIPT' } }),
      this.prisma.platformSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default' },
        update: {},
      }),
      this.prisma.plan.findMany({
        where: { isActive: true, isPublic: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.addon.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const invoicePoints = invoice?.points ?? 3;
    return {
      currency: 'EGP' as const,
      billingPeriod: 'annual' as const,
      trialDays: settings.trialDays,
      trialPoints: settings.trialPoints,
      costs: {
        invoicePromo: invoicePoints,
        invoiceStandard: invoice?.standardPoints ?? 4,
        receipt: receipt?.points ?? 1,
      },
      plans: plans.map((plan) => toPlanView(plan, invoicePoints)),
      addons: addons.map(toAddonView),
    };
  }

  getSubscriptionView(tenantId: string) {
    return this.subscriptions.getSubscriptionView(tenantId);
  }

  async getQuotas(tenantId: string) {
    const [quota, limits] = await Promise.all([
      this.quota.getQuotaSnapshot(tenantId),
      this.limits.snapshot(tenantId),
    ]);
    return { ...quota, users: limits.users, companies: limits.companies };
  }

  async startCheckout(
    tenantId: string,
    userId: string,
    input: StartCheckoutInput,
  ): Promise<ManualCheckoutResult> {
    const planCode = (input.planCode ?? '').trim() || 'UNKNOWN';
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    const contact = await this.points.getSupportContact();

    await this.audit.write({
      action: BILLING_AUDIT_ACTIONS.CHECKOUT_START,
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      metadata: { planCode, mode: 'manual' },
    });

    return {
      mode: 'manual',
      planCode,
      planName: plan?.nameEn ?? planCode,
      planNameAr: plan?.nameAr ?? planCode,
      whatsappUrl: contact.whatsappUrl,
      whatsappDisplay: contact.whatsappDisplay,
    };
  }

  async changePlan(tenantId: string, userId: string, planCode: 'FREE' | 'STARTER' | 'PRO') {
    const targetPlan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!targetPlan || !targetPlan.isActive) {
      throw new BadRequestException('unknown_plan');
    }

    const usage = await this.quota.getUsage(tenantId);
    if (
      usage.documents > targetPlan.documentQuota ||
      usage.branches > targetPlan.branchQuota ||
      usage.devices > targetPlan.deviceQuota
    ) {
      throw new ConflictException('usage_exceeds_target_plan_quotas');
    }

    await this.subscriptions.assignPlan(tenantId, planCode, {
      actorUserId: userId,
      reason: 'self_serve_change_plan',
    });

    return this.subscriptions.getSubscriptionView(tenantId);
  }

  async requestEnterprise(tenantId: string, userId: string, message?: string) {
    await this.audit.write({
      action: BILLING_AUDIT_ACTIONS.ENTERPRISE_REQUEST,
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      metadata: { message: message ?? null },
    });
    return { accepted: true };
  }

  async listInvoices(tenantId: string) {
    const items = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.invoiceRef.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    );
    return { items };
  }
}
