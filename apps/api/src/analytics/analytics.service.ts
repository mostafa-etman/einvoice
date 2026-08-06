import { Injectable } from '@nestjs/common';
import type { Prisma, UsageMeter } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  DOCUMENT_METERS,
  ORG_BRANCH_KEY,
  ORG_CURRENCY_KEY,
  USAGE_METERS,
  aggregateEventsToTotals,
  bucketDateInTz,
  type MeterTotals,
} from './usage-aggregate';
import { UsageEventService } from './usage-event.service';
import { UsageRollupService } from './usage-rollup.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly events: UsageEventService,
    private readonly rollups: UsageRollupService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSummary(input: {
    tenantId: string;
    userId?: string;
    from: string;
    to: string;
    branchId?: string;
    currencyCode?: string;
    rebuild?: boolean;
  }) {
    const timeZone = 'Africa/Cairo';
    if (input.rebuild !== false) {
      await this.rollups.rebuildRange({
        tenantId: input.tenantId,
        fromDate: input.from,
        toDate: input.to,
        timeZone,
      });
    }

    const { totals, asOf } = await this.rollups.summaryFromRollups({
      tenantId: input.tenantId,
      fromDate: input.from,
      toDate: input.to,
      branchId: input.branchId,
      currencyCode: input.currencyCode,
    });

    const notes: string[] = [];
    if (input.branchId || input.currencyCode) {
      notes.push(
        'api_calls and storage_bytes are organization-level and are not split by branch/currency filters',
      );
    }

    if (input.userId) {
      await this.audit.write({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        action: 'analytics.summary.view',
        outcome: 'success',
        metadata: { from: input.from, to: input.to, branchId: input.branchId },
      });
    }

    return {
      from: input.from,
      to: input.to,
      timezone: timeZone,
      asOf: (asOf ?? new Date()).toISOString(),
      filters: {
        branchId: input.branchId ?? null,
        currencyCode: input.currencyCode ?? null,
      },
      totals,
      notes,
    };
  }

  /** Compare rollup summary to live event aggregates (accuracy gate). */
  async accuracyCompare(input: {
    tenantId: string;
    from: string;
    to: string;
    branchId?: string;
    currencyCode?: string;
  }): Promise<{
    fromEvents: MeterTotals;
    fromRollups: MeterTotals;
    match: boolean;
  }> {
    const fromInclusive = new Date(`${input.from}T00:00:00.000Z`);
    fromInclusive.setUTCHours(fromInclusive.getUTCHours() - 36);
    const toExclusive = new Date(`${input.to}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 2);

    const events = await this.events.listInRange(
      input.tenantId,
      fromInclusive,
      toExclusive,
    );

    const inWindow = events.filter((e) => {
      const d = bucketDateInTz(e.occurredAt, 'Africa/Cairo');
      return d >= input.from && d <= input.to;
    });

    const fromEvents = aggregateEventsToTotals(
      inWindow.map((e) => ({
        meter: e.meter,
        quantity: e.quantity.toString(),
        occurredAt: e.occurredAt,
        branchId: e.branchId,
        currencyCode: e.currencyCode,
        documentId: e.documentId,
      })),
      { branchId: input.branchId, currencyCode: input.currencyCode },
    );

    await this.rollups.rebuildRange({
      tenantId: input.tenantId,
      fromDate: input.from,
      toDate: input.to,
    });

    const { totals: fromRollups } = await this.rollups.summaryFromRollups({
      tenantId: input.tenantId,
      fromDate: input.from,
      toDate: input.to,
      branchId: input.branchId,
      currencyCode: input.currencyCode,
    });

    const match = USAGE_METERS.every((m) => fromEvents[m] === fromRollups[m]);

    return { fromEvents, fromRollups, match };
  }

  async getSeries(input: {
    tenantId: string;
    from: string;
    to: string;
    grain: 'day' | 'month';
    branchId?: string;
    currencyCode?: string;
  }) {
    await this.rollups.rebuildRange({
      tenantId: input.tenantId,
      fromDate: input.from,
      toDate: input.to,
    });

    return this.tenantPrisma.withTenant(input.tenantId, async (tx) => {
      if (input.grain === 'month') {
        const toExclusive = new Date(`${input.to}T00:00:00.000Z`);
        toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
        const rows = await tx.usageMonthlyRollup.findMany({
          where: {
            tenantId: input.tenantId,
            bucketMonth: {
              gte: new Date(`${input.from.slice(0, 7)}-01T00:00:00.000Z`),
              lt: toExclusive,
            },
          },
          orderBy: { bucketMonth: 'asc' },
        });
        const byBucket = new Map<string, typeof rows>();
        for (const r of rows) {
          const key = r.bucketMonth.toISOString().slice(0, 10);
          const list = byBucket.get(key) ?? [];
          list.push(r);
          byBucket.set(key, list);
        }
        const points = [...byBucket.entries()].map(([bucket, list]) => ({
          bucket,
          values: summarizeList(list, input.branchId, input.currencyCode),
        }));
        return { grain: 'month' as const, timezone: 'Africa/Cairo', points };
      }

      const toExclusive = new Date(`${input.to}T00:00:00.000Z`);
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
      const rows = await tx.usageDailyRollup.findMany({
        where: {
          tenantId: input.tenantId,
          bucketDate: {
            gte: new Date(`${input.from}T00:00:00.000Z`),
            lt: toExclusive,
          },
        },
        orderBy: { bucketDate: 'asc' },
      });
      const byBucket = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.bucketDate.toISOString().slice(0, 10);
        const list = byBucket.get(key) ?? [];
        list.push(r);
        byBucket.set(key, list);
      }
      const points = [...byBucket.entries()].map(([bucket, list]) => ({
        bucket,
        values: summarizeList(list, input.branchId, input.currencyCode),
      }));
      return { grain: 'day' as const, timezone: 'Africa/Cairo', points };
    });
  }
}

function summarizeList(
  rows: Array<{
    meter: UsageMeter;
    branchKey: string;
    currencyKey: string;
    value: Prisma.Decimal;
    bucketDate?: Date;
    bucketMonth?: Date;
  }>,
  branchId?: string,
  currencyCode?: string,
): MeterTotals {
  const events = rows
    .filter((r) => {
      const meter = r.meter as (typeof USAGE_METERS)[number];
      if (DOCUMENT_METERS.has(meter)) {
        if (branchId && r.branchKey !== branchId) return false;
        if (currencyCode && r.currencyKey !== currencyCode) return false;
      } else {
        if (r.branchKey !== ORG_BRANCH_KEY) return false;
        if (r.currencyKey !== ORG_CURRENCY_KEY) return false;
      }
      return true;
    })
    .map((r) => ({
      meter: r.meter,
      quantity: r.value.toString(),
      occurredAt: r.bucketDate ?? r.bucketMonth ?? new Date(),
      branchId: r.branchKey === ORG_BRANCH_KEY ? null : r.branchKey,
      currencyCode: r.currencyKey === ORG_CURRENCY_KEY ? null : r.currencyKey,
    }));
  return aggregateEventsToTotals(events, { branchId, currencyCode });
}
