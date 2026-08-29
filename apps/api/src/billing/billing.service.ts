import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';
import { PointsService } from './points.service';
import { QuotaService } from './quota.service';
import { SubscriptionService } from './subscription.service';

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
  ) {}

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return { plans: plans.map((plan) => this.toPlanView(plan)) };
  }

  getSubscriptionView(tenantId: string) {
    return this.subscriptions.getSubscriptionView(tenantId);
  }

  getQuotas(tenantId: string) {
    return this.quota.getQuotaSnapshot(tenantId);
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
    if (!targetPlan) {
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

  private toPlanView(plan: Plan) {
    return {
      code: plan.code,
      name: plan.nameEn,
      nameAr: plan.nameAr,
      documentQuota: plan.documentQuota,
      branchQuota: plan.branchQuota,
      deviceQuota: plan.deviceQuota,
      selfServe: plan.selfServe,
      includedPoints: plan.includedPoints,
      priceDisplay: null as string | null,
    };
  }
}
