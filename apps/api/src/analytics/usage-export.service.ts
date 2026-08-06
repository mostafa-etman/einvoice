import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { Prisma, UsageExportFormat, UsageExportJobStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsageRollupService } from './usage-rollup.service';
import { USAGE_METERS, type MeterTotals } from './usage-aggregate';
import type { ArtifactStorage } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_USAGE_EXPORT,
  type UsageExportJobData,
} from '../queues/queue-names';

export type CreateUsageExportInput = {
  tenantId: string;
  userId: string;
  format: 'CSV' | 'XLSX';
  from: string;
  to: string;
  branchId?: string | null;
  currencyCode?: string | null;
  grain?: 'day' | 'month';
};

@Injectable()
export class UsageExportService {
  private readonly log = new Logger(UsageExportService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly rollups: UsageRollupService,
    private readonly audit: AuditService,
    @Inject('ArtifactStorage') private readonly storage: ArtifactStorage,
    @InjectQueue(QUEUE_USAGE_EXPORT) private readonly exportQueue: Queue,
  ) {}

  async createExport(input: CreateUsageExportInput) {
    const format =
      input.format === 'XLSX' ? UsageExportFormat.XLSX : UsageExportFormat.CSV;
    const job = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.usageExportJob.create({
        data: {
          tenantId: input.tenantId,
          createdByUserId: input.userId,
          status: UsageExportJobStatus.QUEUED,
          format,
          filtersJson: {
            from: input.from,
            to: input.to,
            branchId: input.branchId ?? null,
            currencyCode: input.currencyCode ?? null,
            grain: input.grain ?? 'day',
          },
        },
      }),
    );

    await this.exportQueue.add(
      'usage-export',
      {
        tenantId: input.tenantId,
        usageExportJobId: job.id,
      } satisfies UsageExportJobData,
      { removeOnComplete: 50, removeOnFail: 50 },
    );

    await this.audit.write({
      action: 'analytics.export.create',
      outcome: 'success',
      actorUserId: input.userId,
      tenantId: input.tenantId,
      resourceType: 'usage_export_job',
      resourceId: job.id,
      metadata: { format: input.format },
    });

    return this.toDto(job);
  }

  async listExports(tenantId: string, limit = 20) {
    const items = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.usageExportJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(50, Math.max(1, limit)),
      }),
    );
    return { items: items.map((j) => this.toDto(j)) };
  }

  async getExport(tenantId: string, jobId: string) {
    const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.usageExportJob.findFirst({ where: { id: jobId, tenantId } }),
    );
    if (!job) throw new NotFoundException('Export job not found');
    return this.toDto(job);
  }

  async download(
    tenantId: string,
    jobId: string,
    userId?: string,
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.usageExportJob.findFirst({ where: { id: jobId, tenantId } }),
    );
    if (!job) throw new NotFoundException('Export job not found');
    if (job.status !== UsageExportJobStatus.READY || !job.objectKey) {
      throw new NotFoundException('Export not ready');
    }
    const buffer = await this.storage.getByKey(job.objectKey);
    if (userId) {
      await this.audit.write({
        action: 'analytics.export.download',
        outcome: 'success',
        actorUserId: userId,
        tenantId,
        resourceType: 'usage_export_job',
        resourceId: jobId,
      });
    }
    const isXlsx = job.format === UsageExportFormat.XLSX;
    return {
      buffer,
      contentType: isXlsx
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      fileName: `usage-analytics-${jobId}.${isXlsx ? 'xlsx' : 'csv'}`,
    };
  }

  async processExport(tenantId: string, jobId: string): Promise<void> {
    const env = loadEnv();
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.usageExportJob.update({
        where: { id: jobId },
        data: { status: UsageExportJobStatus.RUNNING },
      });
    });

    try {
      const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.usageExportJob.findFirstOrThrow({ where: { id: jobId, tenantId } }),
      );
      const filters = job.filtersJson as {
        from: string;
        to: string;
        branchId?: string | null;
        currencyCode?: string | null;
        grain?: 'day' | 'month';
      };

      await this.rollups.rebuildRange({
        tenantId,
        fromDate: filters.from,
        toDate: filters.to,
        timeZone: env.USAGE_METERING_TIMEZONE,
      });

      const { totals } = await this.rollups.summaryFromRollups({
        tenantId,
        fromDate: filters.from,
        toDate: filters.to,
        branchId: filters.branchId,
        currencyCode: filters.currencyCode,
      });

      const seriesRows = await this.loadSeriesRows(
        tenantId,
        filters.from,
        filters.to,
        filters.grain ?? 'day',
        filters.branchId,
        filters.currencyCode,
      );

      const buffer =
        job.format === UsageExportFormat.XLSX
          ? this.toXlsx(totals, seriesRows, filters)
          : this.toCsv(totals, seriesRows, filters);

      const objectId = `${jobId}.${job.format === UsageExportFormat.XLSX ? 'xlsx' : 'csv'}`;
      const put = await this.storage.put({
        tenantId,
        kind: 'analytics',
        objectId,
        contentType:
          job.format === UsageExportFormat.XLSX
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
        body: buffer,
      });

      const expiresAt = new Date();
      expiresAt.setUTCDate(expiresAt.getUTCDate() + env.USAGE_EXPORT_TTL_DAYS);

      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.usageExportJob.update({
          where: { id: jobId },
          data: {
            status: UsageExportJobStatus.READY,
            objectKey: put.key,
            byteSize: put.byteSize,
            expiresAt,
            errorSummary: null,
          },
        }),
      );
    } catch (e) {
      this.log.error(`export failed ${jobId}: ${String(e)}`);
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.usageExportJob.update({
          where: { id: jobId },
          data: {
            status: UsageExportJobStatus.FAILED,
            errorSummary: String(e).slice(0, 1000),
          },
        }),
      );
    }
  }

  private async loadSeriesRows(
    tenantId: string,
    from: string,
    to: string,
    grain: 'day' | 'month',
    branchId?: string | null,
    currencyCode?: string | null,
  ): Promise<Array<{ bucket: string; values: MeterTotals }>> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const toExclusive = new Date(`${to}T00:00:00.000Z`);
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
      if (grain === 'month') {
        const rows = await tx.usageMonthlyRollup.findMany({
          where: {
            tenantId,
            bucketMonth: {
              gte: new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`),
              lt: toExclusive,
            },
          },
        });
        return groupRollupRows(rows, 'month', branchId, currencyCode);
      }
      const rows = await tx.usageDailyRollup.findMany({
        where: {
          tenantId,
          bucketDate: {
            gte: new Date(`${from}T00:00:00.000Z`),
            lt: toExclusive,
          },
        },
      });
      return groupRollupRows(rows, 'day', branchId, currencyCode);
    });
  }

  private toCsv(
    totals: MeterTotals,
    series: Array<{ bucket: string; values: MeterTotals }>,
    filters: Record<string, unknown>,
  ): Buffer {
    const lines = [
      '# usage analytics export',
      `# filters=${JSON.stringify(filters)}`,
      'section,bucket,' + USAGE_METERS.join(','),
      `summary,total,${USAGE_METERS.map((m) => totals[m]).join(',')}`,
      ...series.map(
        (p) =>
          `series,${p.bucket},${USAGE_METERS.map((m) => p.values[m]).join(',')}`,
      ),
    ];
    return Buffer.from(lines.join('\n') + '\n', 'utf8');
  }

  private toXlsx(
    totals: MeterTotals,
    series: Array<{ bucket: string; values: MeterTotals }>,
    filters: Record<string, unknown>,
  ): Buffer {
    const summary = [
      { section: 'filters', ...filters },
      {
        section: 'summary',
        ...Object.fromEntries(USAGE_METERS.map((m) => [m, totals[m]])),
      },
    ];
    const seriesRows = series.map((p) => ({
      bucket: p.bucket,
      ...Object.fromEntries(USAGE_METERS.map((m) => [m, p.values[m]])),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summary),
      'Summary',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(seriesRows),
      'Series',
    );
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  private toDto(job: {
    id: string;
    status: UsageExportJobStatus;
    format: UsageExportFormat;
    filtersJson: Prisma.JsonValue;
    byteSize: number | null;
    errorSummary: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      status: job.status,
      format: job.format,
      filters: job.filtersJson,
      byteSize: job.byteSize,
      errorSummary: job.errorSummary,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}

import {
  DOCUMENT_METERS,
  ORG_BRANCH_KEY,
  ORG_CURRENCY_KEY,
  aggregateEventsToTotals,
  emptyTotals,
  type UsageMeterCode,
} from './usage-aggregate';
import type { UsageMeter } from '@prisma/client';

function groupRollupRows(
  rows: Array<{
    meter: UsageMeter;
    branchKey: string;
    currencyKey: string;
    value: Prisma.Decimal;
    bucketDate?: Date;
    bucketMonth?: Date;
  }>,
  grain: 'day' | 'month',
  branchId?: string | null,
  currencyCode?: string | null,
): Array<{ bucket: string; values: MeterTotals }> {
  const byBucket = new Map<string, typeof rows>();
  for (const r of rows) {
    const bucket = (
      grain === 'month' ? r.bucketMonth! : r.bucketDate!
    )
      .toISOString()
      .slice(0, 10);
    const list = byBucket.get(bucket) ?? [];
    list.push(r);
    byBucket.set(bucket, list);
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, list]) => {
      const events = list
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
          occurredAt: r.bucketDate ?? r.bucketMonth ?? new Date(),
          branchId: r.branchKey === ORG_BRANCH_KEY ? null : r.branchKey,
          currencyCode:
            r.currencyKey === ORG_CURRENCY_KEY ? null : r.currencyKey,
        }));
      return {
        bucket,
        values: events.length
          ? aggregateEventsToTotals(events, { branchId, currencyCode })
          : emptyTotals(),
      };
    });
}
