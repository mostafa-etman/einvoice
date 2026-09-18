import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentPurpose, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PLATFORM_AUDIT_ACTIONS } from './platform-audit';
import {
  deriveManualBillingStatus,
  type ManualBillingStatus,
} from './manual-billing-status';

const PURPOSES: PaymentPurpose[] = ['PLAN', 'RENEWAL', 'POINTS_TOPUP', 'ADDON', 'OTHER'];
const STATUSES: ManualBillingStatus[] = [
  'PAID',
  'PARTIALLY_PAID',
  'UNPAID',
  'DUE_SOON',
  'OVERDUE',
];

export type PaymentsFilter = 'all' | 'unpaid' | 'overdue' | ManualBillingStatus;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { q?: string; status?: string }) {
    const rows = await this.loadAccountRows();
    const term = query.q?.trim().toLowerCase() ?? '';
    const filter = parseFilter(query.status);
    const items = rows.filter((row) => {
      if (filter === 'unpaid' && row.outstandingEgp <= 0) return false;
      if (filter === 'overdue' && row.status !== 'OVERDUE') return false;
      if (STATUSES.includes(filter as ManualBillingStatus) && row.status !== filter) {
        return false;
      }
      if (!term) return true;
      const hay = [
        row.accountId,
        row.ownerEmail ?? '',
        row.ownerName ?? '',
        row.planCode ?? '',
        ...row.companies.map((c) => c.name),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });

    const summary = {
      totalCollectedEgp: rows.reduce((sum, r) => sum + r.amountPaidEgp, 0),
      totalOutstandingEgp: rows.reduce((sum, r) => sum + Math.max(0, r.outstandingEgp), 0),
      overdueCount: rows.filter((r) => r.status === 'OVERDUE').length,
    };

    return { items, summary };
  }

  async getAccount(accountId: string) {
    const rows = await this.loadAccountRows(accountId);
    const account = rows[0];
    if (!account) throw new NotFoundException('account_not_found');
    const payments = await this.prisma.accountPayment.findMany({
      where: { accountId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      ...account,
      payments: payments.map((p) => ({
        id: p.id,
        amountEgp: p.amountEgp,
        currency: p.currency,
        paidAt: p.paidAt.toISOString(),
        purpose: p.purpose,
        method: p.method,
        reference: p.reference,
        notes: p.notes,
        createdByUserId: p.createdByUserId,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async addPayment(
    accountId: string,
    operatorUserId: string,
    body: {
      amountEgp?: number;
      paidAt?: string;
      purpose?: string;
      method?: string;
      reference?: string;
      notes?: string;
    },
  ) {
    await this.requireAccount(accountId);
    const amountEgp = Number(body.amountEgp);
    if (!Number.isInteger(amountEgp) || amountEgp <= 0) {
      throw new BadRequestException('amount_egp_required');
    }
    const purpose = body.purpose as PaymentPurpose;
    if (!PURPOSES.includes(purpose)) {
      throw new BadRequestException('invalid_purpose');
    }
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException('invalid_paid_at');
    }

    const row = await this.prisma.accountPayment.create({
      data: {
        accountId,
        amountEgp,
        currency: 'EGP',
        paidAt,
        purpose,
        method: emptyToNull(body.method),
        reference: emptyToNull(body.reference),
        notes: emptyToNull(body.notes),
        createdByUserId: operatorUserId,
      },
    });

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.PAYMENT_RECORD,
      outcome: 'success',
      actorUserId: operatorUserId,
      resourceType: 'account_payment',
      resourceId: row.id,
      metadata: { accountId, amountEgp, purpose },
    });

    return this.getAccount(accountId);
  }

  async updateBilling(
    accountId: string,
    operatorUserId: string,
    body: {
      amountDueEgp?: number;
      dueDate?: string | null;
      periodStart?: string | null;
      periodEnd?: string | null;
    },
  ) {
    const account = await this.requireAccount(accountId);
    const data: Prisma.AccountUpdateInput = {};
    if (body.amountDueEgp !== undefined) {
      const amountDueEgp = Number(body.amountDueEgp);
      if (!Number.isInteger(amountDueEgp) || amountDueEgp < 0) {
        throw new BadRequestException('invalid_amount_due');
      }
      data.amountDueEgp = amountDueEgp;
    }
    if (body.dueDate !== undefined) {
      data.dueDate = parseOptionalDate(body.dueDate, 'invalid_due_date');
    }
    if (Object.keys(data).length) {
      await this.prisma.account.update({ where: { id: accountId }, data });
    }

    if (body.periodStart !== undefined || body.periodEnd !== undefined) {
      const tenantId = account.tenants[0]?.id;
      if (tenantId) {
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.subscription.updateMany({
            where: { accountId },
            data: {
              ...(body.periodStart !== undefined
                ? { currentPeriodStart: parseOptionalDate(body.periodStart, 'invalid_period_start') }
                : {}),
              ...(body.periodEnd !== undefined
                ? { currentPeriodEnd: parseOptionalDate(body.periodEnd, 'invalid_period_end') }
                : {}),
            },
          }),
        );
      }
    }

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.PAYMENT_BILLING_UPDATE,
      outcome: 'success',
      actorUserId: operatorUserId,
      resourceType: 'account',
      resourceId: accountId,
      metadata: {
        amountDueEgp: body.amountDueEgp ?? null,
        dueDate: body.dueDate ?? null,
      },
    });

    return this.getAccount(accountId);
  }

  private async requireAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: {
        tenants: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    if (!account) throw new NotFoundException('account_not_found');
    return account;
  }

  private async loadAccountRows(accountId?: string) {
    const accounts = await this.prisma.account.findMany({
      where: accountId ? { id: accountId } : undefined,
      include: {
        owner: { select: { email: true, name: true } },
        tenants: {
          select: { id: true, name: true },
          orderBy: { createdAt: 'asc' },
        },
        payments: { select: { amountEgp: true, paidAt: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    return accounts.map((account) => {
      const subscription = account.subscription;
      const amountPaidEgp = account.payments.reduce((sum, p) => sum + p.amountEgp, 0);
      const lastPaymentAt = account.payments.reduce<Date | null>((latest, p) => {
        if (!latest || p.paidAt > latest) return p.paidAt;
        return latest;
      }, null);
      const planPriceEgp =
        subscription?.plan.discountedPriceEgp || subscription?.plan.officialPriceEgp || 0;
      const dueDate = account.dueDate ?? subscription?.currentPeriodEnd ?? null;
      const amountDueEgp = account.amountDueEgp;
      const outstandingEgp = amountDueEgp - amountPaidEgp;
      const status = deriveManualBillingStatus({
        amountDueEgp,
        amountPaidEgp,
        dueDate,
        now,
      });
      return {
        accountId: account.id,
        ownerEmail: account.owner?.email ?? null,
        ownerName: account.owner?.name ?? null,
        companies: account.tenants.map((t) => ({ id: t.id, name: t.name })),
        planCode: subscription?.plan.code ?? null,
        planNameEn: subscription?.plan.nameEn ?? null,
        planNameAr: subscription?.plan.nameAr ?? null,
        planPriceEgp,
        periodStart: subscription?.currentPeriodStart?.toISOString() ?? null,
        periodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
        amountDueEgp,
        amountPaidEgp,
        outstandingEgp,
        lastPaymentAt: lastPaymentAt?.toISOString() ?? null,
        dueDate: dueDate?.toISOString() ?? null,
        status,
      };
    });
  }
}

function parseFilter(status?: string): PaymentsFilter {
  if (!status || status === 'all') return 'all';
  if (status === 'unpaid' || status === 'overdue') return status;
  if (STATUSES.includes(status as ManualBillingStatus)) return status as ManualBillingStatus;
  throw new BadRequestException('invalid_status_filter');
}

function emptyToNull(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalDate(value: string | null, error: string): Date | null {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(error);
  return date;
}
