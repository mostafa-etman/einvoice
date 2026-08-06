import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';
import { BILLING_PROVIDER, type BillingProvider } from './providers/billing-provider';
import { QuotaService } from './quota.service';
import { SubscriptionService } from './subscription.service';

export type StartCheckoutInput = {
  planCode: 'STARTER' | 'PRO';
  successUrl?: string;
  cancelUrl?: string;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly subscriptions: SubscriptionService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
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

  async startCheckout(tenantId: string, userId: string, input: StartCheckoutInput) {
    const plan = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.selfServe) {
      throw new BadRequestException('plan_not_self_serve');
    }

    await this.audit.write({
      action: BILLING_AUDIT_ACTIONS.CHECKOUT_START,
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      metadata: { planCode: input.planCode },
    });

    try {
      const customer = await this.ensurePaymentCustomer(tenantId, userId);
      const result = await this.provider.createCheckoutSession({
        tenantId,
        planCode: input.planCode,
        stripePriceId: plan.stripePriceId,
        customerId: customer.providerCustomerId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });
      await this.audit.write({
        action: BILLING_AUDIT_ACTIONS.CHECKOUT_SUCCESS,
        outcome: 'success',
        actorUserId: userId,
        tenantId,
        metadata: { planCode: input.planCode },
      });
      return result;
    } catch (err) {
      await this.audit.write({
        action: BILLING_AUDIT_ACTIONS.CHECKOUT_FAIL,
        outcome: 'failure',
        actorUserId: userId,
        tenantId,
        metadata: {
          planCode: input.planCode,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
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

  private async ensurePaymentCustomer(tenantId: string, userId: string) {
    const providerId = this.provider.id;
    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.paymentCustomer.findUnique({
        where: { tenantId_provider: { tenantId, provider: providerId } },
      }),
    );
    if (existing) return existing;

    const [user, tenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    ]);
    const result = await this.provider.createCustomer({
      tenantId,
      email: user?.email ?? `tenant-${tenantId}@invoices.local`,
      name: tenant?.name,
    });

    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.paymentCustomer.create({
        data: { tenantId, provider: providerId, providerCustomerId: result.providerCustomerId },
      }),
    );
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
      priceDisplay: null as string | null,
    };
  }
}
