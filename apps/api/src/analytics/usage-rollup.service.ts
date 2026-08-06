import { Injectable } from '@nestjs/common';
import { Prisma, UsageMeter } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  DOCUMENT_METERS,
  ORG_BRANCH_KEY,
  ORG_CURRENCY_KEY,
  aggregateEventsToTotals,
  bucketDateInTz,
  branchKeyOf,
  currencyKeyOf,
  monthStartFromBucketDate,
  toNumber,
  type MeterTotals,
  type UsageMeterCode,
} from './usage-aggregate';

@Injectable()
export class UsageRollupService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Rebuild daily + monthly rollups for a tenant over [from, to] (dates inclusive
   * as calendar days in metering TZ).
   */
  async rebuildRange(input: {
    tenantId: string;
    fromDate: string;
    toDate: string;
    timeZone?: string;
  }): Promise<{ asOf: Date; days: number }> {
    const timeZone = input.timeZone ?? 'Africa/Cairo';
    const asOf = new Date();
    const fromInclusive = new Date(`${input.fromDate}T00:00:00.000Z`);
    const padStart = new Date(fromInclusive.getTime() - 36 * 3600_000);
    const toExclusive = new Date(`${input.toDate}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 2);

    return this.tenantPrisma.withTenant(input.tenantId, async (tx) => {
      const events = await tx.usageEvent.findMany({
        where: {
          tenantId: input.tenantId,
          occurredAt: { gte: padStart, lt: toExclusive },
        },
      });

      type DimKey = string;
      const daily = new Map<
        DimKey,
        {
          meter: UsageMeterCode;
          branchKey: string;
          currencyKey: string;
          bucketDate: string;
          events: typeof events;
        }
      >();

      for (const e of events) {
        const bucketDate = bucketDateInTz(e.occurredAt, timeZone);
        if (bucketDate < input.fromDate || bucketDate > input.toDate) continue;
        const meter = e.meter as UsageMeterCode;
        const bKey = branchKeyOf(e.branchId);
        const cKey = currencyKeyOf(e.currencyCode);
        const key = `${bucketDate}|${meter}|${bKey}|${cKey}`;
        let row = daily.get(key);
        if (!row) {
          row = {
            meter,
            branchKey: bKey,
            currencyKey: cKey,
            bucketDate,
            events: [],
          };
          daily.set(key, row);
        }
        row.events.push(e);
      }

      const months = new Set<string>();

      for (const row of daily.values()) {
        const totals = aggregateEventsToTotals(
          row.events.map((e) => ({
            meter: e.meter,
            quantity: e.quantity.toString(),
            occurredAt: e.occurredAt,
            branchId: e.branchId,
            currencyCode: e.currencyCode,
            documentId: e.documentId,
          })),
        );
        const value = totals[row.meter];
        await tx.usageDailyRollup.upsert({
          where: {
            tenantId_bucketDate_meter_branchKey_currencyKey: {
              tenantId: input.tenantId,
              bucketDate: new Date(`${row.bucketDate}T00:00:00.000Z`),
              meter: row.meter as UsageMeter,
              branchKey: row.branchKey,
              currencyKey: row.currencyKey,
            },
          },
          create: {
            tenantId: input.tenantId,
            bucketDate: new Date(`${row.bucketDate}T00:00:00.000Z`),
            meter: row.meter as UsageMeter,
            branchKey: row.branchKey,
            currencyKey: row.currencyKey,
            value: new Prisma.Decimal(value),
            eventCount: row.events.length,
            asOf,
          },
          update: {
            value: new Prisma.Decimal(value),
            eventCount: row.events.length,
            asOf,
          },
        });
        months.add(monthStartFromBucketDate(row.bucketDate));
      }

      for (const monthStart of months) {
        const monthEnd = new Date(`${monthStart}T00:00:00.000Z`);
        monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
        const dailies = await tx.usageDailyRollup.findMany({
          where: {
            tenantId: input.tenantId,
            bucketDate: {
              gte: new Date(`${monthStart}T00:00:00.000Z`),
              lt: monthEnd,
            },
          },
        });

        type MKey = string;
        const groups = new Map<
          MKey,
          {
            meter: UsageMeter;
            branchKey: string;
            currencyKey: string;
            rows: typeof dailies;
          }
        >();
        for (const d of dailies) {
          const key = `${d.meter}|${d.branchKey}|${d.currencyKey}`;
          let g = groups.get(key);
          if (!g) {
            g = {
              meter: d.meter,
              branchKey: d.branchKey,
              currencyKey: d.currencyKey,
              rows: [],
            };
            groups.set(key, g);
          }
          g.rows.push(d);
        }

        for (const g of groups.values()) {
          let value = 0;
          if (g.meter === 'storage_bytes') {
            const sorted = [...g.rows].sort(
              (a, b) => a.bucketDate.getTime() - b.bucketDate.getTime(),
            );
            value = toNumber(sorted[sorted.length - 1]!.value.toString());
          } else {
            value = g.rows.reduce(
              (s, r) => s + toNumber(r.value.toString()),
              0,
            );
          }
          await tx.usageMonthlyRollup.upsert({
            where: {
              tenantId_bucketMonth_meter_branchKey_currencyKey: {
                tenantId: input.tenantId,
                bucketMonth: new Date(`${monthStart}T00:00:00.000Z`),
                meter: g.meter,
                branchKey: g.branchKey,
                currencyKey: g.currencyKey,
              },
            },
            create: {
              tenantId: input.tenantId,
              bucketMonth: new Date(`${monthStart}T00:00:00.000Z`),
              meter: g.meter,
              branchKey: g.branchKey,
              currencyKey: g.currencyKey,
              value: new Prisma.Decimal(value),
              asOf,
            },
            update: {
              value: new Prisma.Decimal(value),
              asOf,
            },
          });
        }
      }

      return { asOf, days: daily.size };
    });
  }

  async summaryFromRollups(input: {
    tenantId: string;
    fromDate: string;
    toDate: string;
    branchId?: string | null;
    currencyCode?: string | null;
  }): Promise<{ totals: MeterTotals; asOf: Date | null }> {
    return this.tenantPrisma.withTenant(input.tenantId, async (tx) => {
      const toExclusive = new Date(`${input.toDate}T00:00:00.000Z`);
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

      const rows = await tx.usageDailyRollup.findMany({
        where: {
          tenantId: input.tenantId,
          bucketDate: {
            gte: new Date(`${input.fromDate}T00:00:00.000Z`),
            lt: toExclusive,
          },
        },
      });

      const totals = summarizeDailyRows(rows, input.branchId, input.currencyCode);
      const asOf =
        rows.reduce<Date | null>((max, r) => {
          if (!max || r.asOf > max) return r.asOf;
          return max;
        }, null) ?? null;
      return { totals, asOf };
    });
  }
}

function summarizeDailyRows(
  rows: Array<{
    meter: UsageMeter;
    branchKey: string;
    currencyKey: string;
    value: Prisma.Decimal;
    bucketDate: Date;
  }>,
  branchId?: string | null,
  currencyCode?: string | null,
): MeterTotals {
  const events = rows
    .filter((r) => {
      const meter = r.meter as UsageMeterCode;
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
      occurredAt: r.bucketDate,
      branchId: r.branchKey === ORG_BRANCH_KEY ? null : r.branchKey,
      currencyCode: r.currencyKey === ORG_CURRENCY_KEY ? null : r.currencyKey,
    }));

  return aggregateEventsToTotals(events, { branchId, currencyCode });
}
