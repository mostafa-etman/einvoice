import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  Logger,
  GoneException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaDocumentPackageClient } from '../eta/eta-document-package.client';
import {
  exportDocsToCsv,
  exportDocsToJson,
  exportDocsToPdfInventory,
  exportDocsToXlsx,
  type ExportDocRow,
} from './local-exporters';
import {
  QUEUE_EXPORT,
  QUEUE_PACKAGE_POLL,
  type ExportJobData,
  type PackagePollJobData,
} from '../queues/queue-names';
import type { ArtifactStorage } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import { tenantArtifactKey } from '../storage/minio-artifact.store';

export type LocalExportFilters = {
  from?: string;
  to?: string;
  documentTypes?: string[];
  statuses?: string[];
  branchId?: string;
};

@Injectable()
export class ExportsService {
  private readonly log = new Logger(ExportsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly eta: EtaService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
    @InjectQueue(QUEUE_EXPORT) private readonly exportQueue: Queue<ExportJobData>,
    @InjectQueue(QUEUE_PACKAGE_POLL)
    private readonly packageQueue: Queue<PackagePollJobData>,
  ) {}

  async listJobs(tenantId: string, kind?: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.exportJob.findMany({
        where: {
          tenantId,
          ...(kind ? { kind: kind as 'LOCAL' | 'ETA_PACKAGE' } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { etaPackageRequest: true },
      }),
    );
  }

  async getJob(tenantId: string, jobId: string) {
    const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.exportJob.findFirst({
        where: { id: jobId, tenantId },
        include: { etaPackageRequest: true },
      }),
    );
    if (!job) throw new NotFoundException('Export job not found');
    return {
      ...job,
      etaPackage: job.etaPackageRequest
        ? {
            etaRequestId: job.etaPackageRequest.etaRequestId,
            localStatus: job.etaPackageRequest.localStatus,
            etaStatusRaw: job.etaPackageRequest.etaStatusRaw,
            readyAt: job.etaPackageRequest.readyAt,
          }
        : null,
    };
  }

  async createLocalExport(args: {
    tenantId: string;
    userId: string;
    formats: Array<'CSV' | 'XLSX' | 'PDF' | 'JSON'>;
    filters: LocalExportFilters;
  }) {
    if (!args.formats?.length) {
      throw new BadRequestException('At least one format required');
    }
    const env = loadEnv();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.EXPORT_ARTIFACT_TTL_DAYS);

    const job = await this.tenantPrisma.withTenant(args.tenantId, (tx) =>
      tx.exportJob.create({
        data: {
          tenantId: args.tenantId,
          createdByUserId: args.userId,
          kind: 'LOCAL',
          status: 'QUEUED',
          filtersJson: args.filters as Prisma.InputJsonValue,
          formatsJson: args.formats as Prisma.InputJsonValue,
          expiresAt,
        },
      }),
    );

    await this.exportQueue.add(
      'local',
      { tenantId: args.tenantId, exportJobId: job.id },
      { removeOnComplete: 100, removeOnFail: 50 },
    );

    await this.audit.write({
      action: 'exports.local.create',
      outcome: 'success',
      actorUserId: args.userId,
      tenantId: args.tenantId,
      resourceType: 'export_job',
      resourceId: job.id,
      metadata: { formats: args.formats },
    });

    return job;
  }

  async createEtaPackage(args: {
    tenantId: string;
    userId: string;
    dateFrom: string;
    dateTo: string;
    documentTypeNames?: string[];
    statuses?: string[];
    type?: 'full' | 'summary';
    format?: 'JSON' | 'XML' | 'CSV';
  }) {
    const env = loadEnv();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.EXPORT_ARTIFACT_TTL_DAYS);

    const job = await this.tenantPrisma.withTenant(args.tenantId, (tx) =>
      tx.exportJob.create({
        data: {
          tenantId: args.tenantId,
          createdByUserId: args.userId,
          kind: 'ETA_PACKAGE',
          status: 'QUEUED',
          filtersJson: {
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            documentTypeNames: args.documentTypeNames,
            statuses: args.statuses,
          } as Prisma.InputJsonValue,
          formatsJson: [],
          expiresAt,
        },
      }),
    );

    const token = await this.eta.getAccessToken(args.tenantId);
    const client = new EtaDocumentPackageClient(env.ETA_API_BASE_URL);
    const { requestId } = await client.requestDocumentPackage(token, {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      documentTypeNames: args.documentTypeNames,
      statuses: args.statuses,
      type: args.type ?? 'full',
      format: args.format ?? 'JSON',
    });

    const pkg = await this.tenantPrisma.withTenant(args.tenantId, (tx) =>
      tx.etaPackageRequest.create({
        data: {
          tenantId: args.tenantId,
          exportJobId: job.id,
          etaRequestId: requestId,
          localStatus: 'REQUESTED',
          requestPayloadJson: {
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
          } as Prisma.InputJsonValue,
        },
      }),
    );

    await this.tenantPrisma.withTenant(args.tenantId, (tx) =>
      tx.exportJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    await this.packageQueue.add(
      'poll',
      {
        tenantId: args.tenantId,
        exportJobId: job.id,
        etaPackageRequestId: pkg.id,
      },
      {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
      },
    );

    await this.audit.write({
      action: 'exports.package.request',
      outcome: 'success',
      actorUserId: args.userId,
      tenantId: args.tenantId,
      resourceType: 'export_job',
      resourceId: job.id,
      metadata: { etaRequestId: requestId },
    });

    return this.getJob(args.tenantId, job.id);
  }

  /** Accelerate next Get Package Requests check (never skip poll / download alone). */
  async acceleratePackagePoll(tenantId: string, etaRequestId: string) {
    const pkg = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.etaPackageRequest.findFirst({
        where: { tenantId, etaRequestId },
      }),
    );
    if (!pkg) return { accelerated: false as const };
    await this.packageQueue.add(
      'poll-accelerate',
      {
        tenantId,
        exportJobId: pkg.exportJobId,
        etaPackageRequestId: pkg.id,
      },
      { removeOnComplete: 50, removeOnFail: 25, delay: 0 },
    );
    await this.audit.write({
      action: 'exports.package.accelerate',
      outcome: 'success',
      tenantId,
      resourceType: 'eta_package_request',
      resourceId: pkg.id,
      metadata: { etaRequestId, via: 'package-ready-notification' },
    });
    return { accelerated: true as const, exportJobId: pkg.exportJobId };
  }

  async download(
    tenantId: string,
    jobId: string,
    format?: string,
    actorUserId?: string,
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const job = await this.getJob(tenantId, jobId);
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      await this.audit.write({
        action: 'exports.download',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'export_job',
        resourceId: jobId,
        metadata: { reason: 'expired' },
      });
      throw new GoneException('Export artifact expired; re-run the export');
    }
    if (job.status !== 'READY') {
      throw new BadRequestException('Export is not READY');
    }
    const keys = (job.artifactObjectKeysJson ?? {}) as Record<string, string>;

    let result: { buffer: Buffer; contentType: string; fileName: string };
    if (job.kind === 'ETA_PACKAGE') {
      const key =
        keys.zip ||
        job.etaPackageRequest?.packageObjectKey ||
        undefined;
      if (!key) throw new NotFoundException('Package artifact missing');
      const buffer = await this.artifacts.getByKey(key);
      result = {
        buffer,
        contentType: 'application/zip',
        fileName: `eta-package-${jobId}.zip`,
      };
    } else {
      const fmt = (format || Object.keys(keys)[0] || '').toLowerCase();
      const key = keys[fmt] || keys[fmt.toUpperCase()];
      if (!key) throw new NotFoundException(`Format ${fmt} not available`);
      const buffer = await this.artifacts.getByKey(key);
      const contentTypes: Record<string, string> = {
        csv: 'text/csv',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        json: 'application/json',
        pdf: 'application/pdf',
      };
      result = {
        buffer,
        contentType: contentTypes[fmt] || 'application/octet-stream',
        fileName: `export-${jobId}.${fmt}`,
      };
    }

    await this.audit.write({
      action: 'exports.download',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'export_job',
      resourceId: jobId,
      metadata: { kind: job.kind, format: format ?? null },
    });
    return result;
  }

  async processLocalExport(tenantId: string, exportJobId: string) {
    const job = await this.getJob(tenantId, exportJobId);
    const filters = (job.filtersJson ?? {}) as LocalExportFilters;
    const formats = (job.formatsJson ?? []) as string[];

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.exportJob.update({
        where: { id: exportJobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    const docs = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: {
          tenantId,
          ...(filters.branchId ? { branchId: filters.branchId } : {}),
          ...(filters.statuses?.length
            ? { status: { in: filters.statuses as never[] } }
            : {}),
          ...(filters.documentTypes?.length
            ? { kind: { in: filters.documentTypes as never[] } }
            : {}),
          ...(filters.from || filters.to
            ? {
                issueDateTime: {
                  ...(filters.from ? { gte: new Date(filters.from) } : {}),
                  ...(filters.to ? { lte: new Date(filters.to) } : {}),
                },
              }
            : {}),
        },
        orderBy: { issueDateTime: 'desc' },
        take: 5000,
      }),
    );

    if (docs.length === 0) {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: 'FAILED',
            errorSummary: 'No documents matched filters',
            finishedAt: new Date(),
          },
        }),
      );
      return;
    }

    const rows: ExportDocRow[] = docs.map((d) => ({
      id: d.id,
      internalId: d.internalId,
      kind: d.kind,
      status: d.status,
      issueDateTime: d.issueDateTime.toISOString(),
      currencyCode: d.currencyCode,
      totalAmount: d.totalAmount,
      netAmount: d.netAmount,
      receiverName: d.receiverName,
      etaUuid: d.etaUuid,
    }));

    const artifactKeys: Record<string, string> = {};
    for (const fmt of formats) {
      const upper = String(fmt).toUpperCase();
      let buf: Buffer;
      let contentType: string;
      let objectId: string;
      if (upper === 'CSV') {
        buf = exportDocsToCsv(rows);
        contentType = 'text/csv';
        objectId = `${exportJobId}.csv`;
      } else if (upper === 'XLSX') {
        buf = exportDocsToXlsx(rows);
        contentType =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        objectId = `${exportJobId}.xlsx`;
      } else if (upper === 'JSON') {
        buf = exportDocsToJson(rows);
        contentType = 'application/json';
        objectId = `${exportJobId}.json`;
      } else if (upper === 'PDF') {
        const pdf = exportDocsToPdfInventory(rows);
        buf = pdf.buffer;
        contentType = pdf.contentType;
        objectId = `${exportJobId}.pdf`;
      } else {
        continue;
      }
      const put = await this.artifacts.put({
        tenantId,
        kind: 'exports',
        objectId,
        contentType,
        body: buf,
      });
      artifactKeys[upper.toLowerCase()] = put.key;
    }

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'READY',
          artifactObjectKeysJson: artifactKeys as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      }),
    );
  }

  async processPackagePoll(
    tenantId: string,
    exportJobId: string,
    etaPackageRequestId: string,
  ) {
    const env = loadEnv();
    const pkg = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.etaPackageRequest.findFirst({
        where: { id: etaPackageRequestId, tenantId },
      }),
    );
    if (!pkg) return;

    const token = await this.eta.getAccessToken(tenantId);
    const client = new EtaDocumentPackageClient(env.ETA_API_BASE_URL);
    const maxPolls = Math.max(
      1,
      Math.ceil(
        (env.PACKAGE_STALL_HOURS * 3600_000) /
          Math.max(env.PACKAGE_POLL_INITIAL_MS, 1),
      ),
    );

    // Resume from existing request id (already requested). Canonical status =
    // Get Package Requests (webhook may only accelerate this loop).
    await (async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let delay = env.PACKAGE_POLL_INITIAL_MS;
      for (let i = 0; i < Math.min(maxPolls, 60); i++) {
        const list = await client.getPackageRequests(token, {
          pageNo: 1,
          pageSize: 50,
        });
        const mine = list.find((x) => x.requestId === pkg.etaRequestId);
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.etaPackageRequest.update({
            where: { id: pkg.id },
            data: {
              lastPolledAt: new Date(),
              etaStatusRaw: mine?.status ?? null,
              localStatus:
                mine?.status === 2
                  ? 'READY'
                  : mine?.status === 3
                    ? 'ERROR'
                    : mine?.status === 4
                      ? 'DELETED'
                      : 'IN_PROGRESS',
            },
          }),
        );
        if (!mine) {
          await sleep(delay);
          delay = Math.min(delay * 2, env.PACKAGE_POLL_MAX_MS);
          continue;
        }
        if (mine.status === 3 || mine.status === 4) {
          await this.tenantPrisma.withTenant(tenantId, (tx) =>
            tx.exportJob.update({
              where: { id: exportJobId },
              data: {
                status: 'FAILED',
                errorSummary: mine.status === 3 ? 'ETA package error' : 'ETA package deleted',
                finishedAt: new Date(),
              },
            }),
          );
          return;
        }
        if (mine.status === 2) {
          const got = await client.getDocumentPackage(token, pkg.etaRequestId);
          if (!got.ready) {
            await sleep(delay);
            continue;
          }
          const objectKey = tenantArtifactKey(
            tenantId,
            'packages',
            `${pkg.etaRequestId}.zip`,
          );
          await this.artifacts.putByKey(objectKey, got.zip, 'application/zip');
          await this.tenantPrisma.withTenant(tenantId, (tx) =>
            tx.etaPackageRequest.update({
              where: { id: pkg.id },
              data: {
                localStatus: 'READY',
                packageObjectKey: objectKey,
                packageByteSize: got.zip.byteLength,
                readyAt: new Date(),
              },
            }),
          );
          await this.tenantPrisma.withTenant(tenantId, (tx) =>
            tx.exportJob.update({
              where: { id: exportJobId },
              data: {
                status: 'READY',
                artifactObjectKeysJson: { zip: objectKey } as Prisma.InputJsonValue,
                finishedAt: new Date(),
              },
            }),
          );
          return;
        }
        await sleep(delay);
        delay = Math.min(delay * 2, env.PACKAGE_POLL_MAX_MS);
      }
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.etaPackageRequest.update({
          where: { id: pkg.id },
          data: { localStatus: 'STALLED' },
        }),
      );
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: 'FAILED',
            errorSummary: 'Package poll stalled',
            finishedAt: new Date(),
          },
        }),
      );
    })();

    this.log.log(`package poll finished for ${exportJobId}`);
  }
}
