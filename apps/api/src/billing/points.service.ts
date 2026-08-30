import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { PointsLedgerReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService, type TenantTx } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';
import { PLATFORM_AUDIT_ACTIONS } from '../platform-admin/platform-audit';
import {
  InsufficientPointsError,
  InsufficientPointsHttpException,
  isTrialExpired,
} from './points-errors';
import { supportWhatsappUrl } from './tenant-lifecycle-status';

export type DocumentCostView = {
  documentKind: string;
  points: number;
  standardPoints: number;
  source: 'platform' | 'tenant';
};

const DEFAULT_KINDS = [
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'EXPORT_INVOICE',
  'EXPORT_CREDIT_NOTE',
  'EXPORT_DEBIT_NOTE',
  'RECEIPT',
] as const;

@Injectable()
export class PointsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Integration tests assume 0 send cost unless a test sets costs explicitly. */
  async onModuleInit() {
    if (loadEnv().NODE_ENV !== 'test') return;
    try {
      await this.prisma.documentPointCost.updateMany({ data: { points: 0 } });
    } catch {
      // Schema not migrated yet in some local boots.
    }
  }

  async getSupportContact() {
    const settings = await this.ensureSettings();
    return {
      whatsappE164: settings.supportWhatsappE164,
      whatsappDisplay: settings.supportWhatsappDisplay,
      whatsappUrl: supportWhatsappUrl(settings.supportWhatsappE164),
    };
  }

  async getBalance(tenantId: string): Promise<number> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pointsBalance: true },
    });
    if (!tenant) throw new NotFoundException('tenant_not_found');
    return tenant.pointsBalance;
  }

  async getEffectiveCosts(tenantId?: string): Promise<DocumentCostView[]> {
    const platform = await this.prisma.documentPointCost.findMany({
      orderBy: { documentKind: 'asc' },
    });
    const byKind = new Map<string, DocumentCostView>();
    for (const kind of DEFAULT_KINDS) {
      byKind.set(kind, { documentKind: kind, points: 0, standardPoints: 0, source: 'platform' });
    }
    for (const row of platform) {
      byKind.set(row.documentKind, {
        documentKind: row.documentKind,
        points: row.points,
        standardPoints: row.standardPoints,
        source: 'platform',
      });
    }
    if (tenantId) {
      const overrides = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.tenantDocumentPointCost.findMany({ where: { tenantId } }),
      );
      for (const row of overrides) {
        const prev = byKind.get(row.documentKind);
        byKind.set(row.documentKind, {
          documentKind: row.documentKind,
          points: row.points,
          standardPoints: prev?.standardPoints ?? 0,
          source: 'tenant',
        });
      }
    }
    return [...byKind.values()].sort((a, b) => a.documentKind.localeCompare(b.documentKind));
  }

  async setPlatformCosts(
    items: Array<{ documentKind: string; points: number; standardPoints?: number }>,
    operatorUserId: string,
  ) {
    for (const item of items) {
      const kind = item.documentKind.trim().toUpperCase();
      const points = Math.max(0, Math.floor(item.points));
      const standardPoints =
        item.standardPoints == null ? points : Math.max(0, Math.floor(item.standardPoints));
      await this.prisma.documentPointCost.upsert({
        where: { documentKind: kind },
        create: { documentKind: kind, points, standardPoints },
        update: { points, standardPoints },
      });
    }
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.POINTS_COSTS_SET,
      outcome: 'success',
      actorUserId: operatorUserId,
      resourceType: 'document_point_cost',
      metadata: { items },
    });
    return this.getEffectiveCosts();
  }

  async setTenantCosts(
    tenantId: string,
    items: Array<{ documentKind: string; points: number }>,
    operatorUserId: string,
  ) {
    await this.assertTenant(tenantId);
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      for (const item of items) {
        const kind = item.documentKind.trim().toUpperCase();
        const points = Math.max(0, Math.floor(item.points));
        await tx.tenantDocumentPointCost.upsert({
          where: { tenantId_documentKind: { tenantId, documentKind: kind } },
          create: { tenantId, documentKind: kind, points },
          update: { points },
        });
      }
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.POINTS_COSTS_SET,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'tenant_document_point_cost',
      resourceId: tenantId,
      metadata: { items },
    });
    return this.getEffectiveCosts(tenantId);
  }

  async adjustBalance(
    tenantId: string,
    delta: number,
    operatorUserId: string,
    note?: string,
  ) {
    if (!Number.isFinite(delta) || delta === 0) {
      return this.snapshot(tenantId);
    }
    const amount = Math.trunc(delta);
    await this.applyDelta(tenantId, amount, 'ADMIN_ADJUST', {
      actorUserId: operatorUserId,
      note: note ?? null,
    });
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.POINTS_ADJUST,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { delta: amount, note: note ?? null },
    });
    return this.snapshot(tenantId);
  }

  async grantTrialPointsIfNeeded(tenantId: string, actorUserId?: string | null) {
    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.pointsLedger.findFirst({ where: { tenantId, reason: 'TRIAL_GRANT' } }),
    );
    if (existing) return;
    const settings = await this.ensureSettings();
    const amount = Math.max(0, settings.trialPoints);
    if (amount <= 0) return;
    await this.applyDelta(tenantId, amount, 'TRIAL_GRANT', {
      actorUserId: actorUserId ?? null,
      note: `trial:${settings.trialDays}d`,
    });
  }

  async grantPlanPointsIfNeeded(tenantId: string, actorUserId?: string | null) {
    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.pointsLedger.findFirst({ where: { tenantId, reason: 'PLAN_GRANT' } }),
    );
    if (existing) return;

    const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    );
    if (subscription?.plan.isTrial) return;
    const included = subscription?.plan.includedPoints ?? 0;
    if (included <= 0) return;

    await this.applyDelta(tenantId, included, 'PLAN_GRANT', {
      actorUserId: actorUserId ?? null,
      note: `plan:${subscription?.plan.code ?? 'unknown'}`,
    });
  }

  /**
   * Deduct send costs inside an existing tenant transaction (before ETA post).
   * No-op when the total cost is 0 so tests and zero-priced kinds stay unchanged.
   */
  async consumeForSendInTx(
    tx: TenantTx,
    input: {
      tenantId: string;
      kinds: string[];
      documentIds: string[];
      submissionId?: string | null;
      actorUserId?: string | null;
    },
  ): Promise<{ total: number; balanceAfter: number }> {
    const tenantRow = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { pointsBalance: true, trialEndsAt: true },
    });
    if (isTrialExpired(tenantRow?.trialEndsAt ?? null)) {
      const contact = await this.getSupportContact();
      throw new InsufficientPointsHttpException(
        new InsufficientPointsError(
          0,
          tenantRow?.pointsBalance ?? 0,
          contact.whatsappUrl,
          contact.whatsappDisplay,
          'TRIAL_ENDED',
        ),
      );
    }

    const costMap = await this.costMapInTx(tx, input.tenantId);
    let total = 0;
    for (const kind of input.kinds) {
      total += costMap.get(kind) ?? costMap.get(this.normalizeKind(kind)) ?? 0;
    }
    if (total <= 0) {
      return { total: 0, balanceAfter: tenantRow?.pointsBalance ?? 0 };
    }

    const updated = await tx.$executeRaw`
      UPDATE tenants
      SET points_balance = points_balance - ${total}, updated_at = now()
      WHERE id = ${input.tenantId}::uuid AND points_balance >= ${total}
    `;
    if (Number(updated) === 0) {
      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { pointsBalance: true },
      });
      const contact = await this.getSupportContact();
      throw new InsufficientPointsHttpException(
        new InsufficientPointsError(
          total,
          tenant?.pointsBalance ?? 0,
          contact.whatsappUrl,
          contact.whatsappDisplay,
        ),
      );
    }

    const after = await tx.tenant.findUniqueOrThrow({
      where: { id: input.tenantId },
      select: { pointsBalance: true },
    });
    await tx.pointsLedger.create({
      data: {
        tenantId: input.tenantId,
        delta: -total,
        balanceAfter: after.pointsBalance,
        reason: 'DOCUMENT_SEND',
        documentKind: input.kinds.length === 1 ? input.kinds[0] : input.kinds.join(','),
        documentId: input.documentIds.length === 1 ? input.documentIds[0] : null,
        submissionId: input.submissionId ?? null,
        actorUserId: input.actorUserId ?? null,
      },
    });
    return { total, balanceAfter: after.pointsBalance };
  }

  async listLedger(
    tenantId: string,
    query: { cursor?: string; limit?: number; from?: Date; to?: Date } = {},
  ) {
    await this.assertTenant(tenantId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.pointsLedger.findMany({
        where: {
          tenantId,
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lt: query.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        take: limit + 1,
      }),
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const consumed = page.filter((r) => r.delta < 0).reduce((sum, r) => sum + Math.abs(r.delta), 0);
    return {
      items: page.map((row) => ({
        id: row.id,
        delta: row.delta,
        balanceAfter: row.balanceAfter,
        reason: row.reason,
        documentKind: row.documentKind,
        documentId: row.documentId,
        submissionId: row.submissionId,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      consumedOnPage: consumed,
    };
  }

  async snapshot(tenantId: string) {
    const [balance, costs] = await Promise.all([
      this.getBalance(tenantId),
      this.getEffectiveCosts(tenantId),
    ]);
    return { tenantId, pointsBalance: balance, costs };
  }

  private async applyDelta(
    tenantId: string,
    delta: number,
    reason: PointsLedgerReason,
    opts: { actorUserId?: string | null; note?: string | null; documentKind?: string | null },
  ) {
    await this.assertTenant(tenantId);
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      if (delta < 0) {
        const updated = await tx.$executeRaw`
          UPDATE tenants
          SET points_balance = points_balance + ${delta}, updated_at = now()
          WHERE id = ${tenantId}::uuid AND points_balance >= ${-delta}
        `;
        if (Number(updated) === 0) {
          const tenant = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { pointsBalance: true },
          });
          const contact = await this.getSupportContact();
          throw new InsufficientPointsHttpException(
            new InsufficientPointsError(
              -delta,
              tenant?.pointsBalance ?? 0,
              contact.whatsappUrl,
              contact.whatsappDisplay,
            ),
          );
        }
      } else {
        await tx.$executeRaw`
          UPDATE tenants
          SET points_balance = points_balance + ${delta}, updated_at = now()
          WHERE id = ${tenantId}::uuid
        `;
      }
      const after = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { pointsBalance: true },
      });
      await tx.pointsLedger.create({
        data: {
          tenantId,
          delta,
          balanceAfter: after.pointsBalance,
          reason,
          actorUserId: opts.actorUserId ?? null,
          note: opts.note ?? null,
          documentKind: opts.documentKind ?? null,
        },
      });
    });
  }

  private async costMapInTx(tx: TenantTx, tenantId: string): Promise<Map<string, number>> {
    const platform = await this.prisma.documentPointCost.findMany();
    const map = new Map<string, number>();
    for (const row of platform) map.set(row.documentKind, row.points);
    const overrides = await tx.tenantDocumentPointCost.findMany({ where: { tenantId } });
    for (const row of overrides) map.set(row.documentKind, row.points);
    return map;
  }

  private normalizeKind(kind: string): string {
    return kind.trim().toUpperCase();
  }

  private async ensureSettings() {
    return this.prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  private async assertTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('tenant_not_found');
  }
}
