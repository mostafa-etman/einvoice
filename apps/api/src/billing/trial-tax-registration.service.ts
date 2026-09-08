import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PLATFORM_AUDIT_ACTIONS } from '../platform-admin/platform-audit';
import { isTrialExpired } from './points-errors';
import { supportWhatsappUrl } from './tenant-lifecycle-status';
import { normalizeTaxRegistration } from './tax-registration';
import { TrialAlreadyUsedHttpException } from './trial-errors';

export type TrialTaxRegistrationView = {
  taxRegistrationNormalized: string;
  firstTenantId: string | null;
  consumedAt: string;
};

@Injectable()
export class TrialTaxRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async assertAvailable(raw: string | null | undefined, tenantId?: string): Promise<void> {
    const normalized = normalizeTaxRegistration(raw);
    if (!normalized) return;
    const existing = await this.prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: normalized },
    });
    if (existing && existing.firstTenantId !== tenantId) {
      throw await this.conflict();
    }
  }

  /**
   * Record that this tax registration consumed a trial.
   * Same tenant re-bind is idempotent. A different tenant throws unless `allowOverride`.
   */
  async consume(
    raw: string | null | undefined,
    tenantId: string,
    opts: { allowOverride?: boolean } = {},
  ): Promise<void> {
    const normalized = normalizeTaxRegistration(raw);
    if (!normalized) return;

    const existing = await this.prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: normalized },
    });
    if (existing) {
      if (existing.firstTenantId === tenantId) return;
      if (opts.allowOverride) return;
      throw await this.conflict();
    }

    try {
      await this.prisma.trialUsedTaxRegistration.create({
        data: {
          taxRegistrationNormalized: normalized,
          firstTenantId: tenantId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.trialUsedTaxRegistration.findUnique({
          where: { taxRegistrationNormalized: normalized },
        });
        if (raced?.firstTenantId === tenantId || opts.allowOverride) return;
        throw await this.conflict();
      }
      throw err;
    }
  }

  /**
   * When a tax number is saved: bind it if this tenant consumed a trial.
   * Active-trial tenants cannot take a number another tenant already used.
   * Paid / expired tenants keep working (migration-safe); we only record unused numbers.
   */
  async bindOnTaxRegistrationSave(tenantId: string, raw: string | null | undefined): Promise<void> {
    const normalized = normalizeTaxRegistration(raw);
    if (!normalized) return;
    if (!(await this.hasConsumedTrial(tenantId))) return;

    const existing = await this.prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: normalized },
    });
    if (!existing) {
      await this.consume(normalized, tenantId);
      return;
    }
    if (existing.firstTenantId === tenantId) return;
    if (await this.isOnActiveTrial(tenantId)) {
      throw await this.conflict();
    }
  }

  /** Throw before persisting credentials when an active trial tries to reuse a TIN. */
  async assertCanBindOnSave(tenantId: string, raw: string | null | undefined): Promise<void> {
    const normalized = normalizeTaxRegistration(raw);
    if (!normalized) return;
    if (!(await this.isOnActiveTrial(tenantId))) return;
    const existing = await this.prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: normalized },
    });
    if (existing && existing.firstTenantId !== tenantId) {
      throw await this.conflict();
    }
  }

  async bindTenantCurrentTaxNumber(
    tenantId: string,
    opts: { allowOverride?: boolean } = {},
  ): Promise<void> {
    const raw = await this.readTenantTaxRegistration(tenantId);
    if (!raw) return;
    await this.consume(raw, tenantId, opts);
  }

  async list(): Promise<{ items: TrialTaxRegistrationView[] }> {
    const rows = await this.prisma.trialUsedTaxRegistration.findMany({
      orderBy: { consumedAt: 'desc' },
      take: 500,
    });
    return {
      items: rows.map((row) => ({
        taxRegistrationNormalized: row.taxRegistrationNormalized,
        firstTenantId: row.firstTenantId,
        consumedAt: row.consumedAt.toISOString(),
      })),
    };
  }

  async reset(raw: string, operatorUserId: string, reason?: string) {
    const normalized = normalizeTaxRegistration(raw);
    if (!normalized) throw new NotFoundException('tax_registration_required');
    const existing = await this.prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: normalized },
    });
    if (!existing) throw new NotFoundException('trial_tax_registration_not_found');
    await this.prisma.trialUsedTaxRegistration.delete({
      where: { taxRegistrationNormalized: normalized },
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.TRIAL_TAX_REG_RESET,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId: existing.firstTenantId,
      resourceType: 'trial_used_tax_registration',
      resourceId: existing.id,
      metadata: { taxRegistrationNormalized: normalized, reason: reason ?? null },
    });
    return { reset: true, taxRegistrationNormalized: normalized };
  }

  private async hasConsumedTrial(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { trialEndsAt: true },
    });
    if (tenant?.trialEndsAt) return true;

    const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
    );
    if (subscription?.plan.isTrial || subscription?.status === 'TRIAL') return true;

    const grant = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.pointsLedger.findFirst({
        where: { tenantId, reason: 'TRIAL_GRANT' },
        select: { id: true },
      }),
    );
    return Boolean(grant);
  }

  private async isOnActiveTrial(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { trialEndsAt: true },
    });
    if (!tenant?.trialEndsAt || isTrialExpired(tenant.trialEndsAt)) return false;
    const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
    );
    return Boolean(subscription?.plan.isTrial || subscription?.status === 'TRIAL');
  }

  private async readTenantTaxRegistration(tenantId: string): Promise<string | null> {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantEtaCredential.findMany({
        where: { tenantId, NOT: { registrationNumber: null } },
        select: { registrationNumber: true, environment: true },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    for (const row of rows) {
      const normalized = normalizeTaxRegistration(row.registrationNumber);
      if (normalized) return normalized;
    }
    return null;
  }

  private async conflict(): Promise<TrialAlreadyUsedHttpException> {
    const settings = await this.prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    return new TrialAlreadyUsedHttpException(
      settings.supportWhatsappDisplay,
      supportWhatsappUrl(settings.supportWhatsappE164),
    );
  }
}
