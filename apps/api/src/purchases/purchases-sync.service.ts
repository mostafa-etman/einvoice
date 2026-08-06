import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma, ReceivedSyncTrigger } from '@prisma/client';
import { loadEnv, shouldRunInProcessCrons } from '../config/env';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaDocumentsSearchClient } from '../eta/eta-documents-search.client';
import { EtaDocumentsRecentClient } from '../eta/eta-documents-recent.client';
import { EtaDocumentDetailsClient } from '../eta/eta-document-details.client';
import {
  mapDetailsLines,
  mapEtaReceivedRow,
} from './received-document.mapper';
import { UsageEmitService } from '../analytics/usage-emit.service';

@Injectable()
export class PurchasesSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurchasesSyncService.name);
  private readonly inFlight = new Set<string>();
  private cronTimer: ReturnType<typeof setInterval> | null = null;
  private readonly syncEnabled: boolean;
  private readonly useRecent: boolean;
  private readonly intervalMs: number;
  private testOverrides: {
    search?: EtaDocumentsSearchClient;
    recent?: EtaDocumentsRecentClient;
    details?: EtaDocumentDetailsClient;
  } = {};

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly eta: EtaService,
    private readonly audit: AuditService,
    private readonly usageEmit: UsageEmitService,
  ) {
    const env = loadEnv();
    this.syncEnabled = env.PURCHASES_SYNC_ENABLED;
    this.useRecent = env.PURCHASES_SYNC_USE_RECENT;
    this.intervalMs = env.PURCHASES_SYNC_INTERVAL_MS;
  }

  private async clientsFor(tenantId: string) {
    const base = await this.eta.getApiBaseUrl(tenantId);
    return {
      search:
        this.testOverrides.search ?? new EtaDocumentsSearchClient(base),
      recent:
        this.testOverrides.recent ?? new EtaDocumentsRecentClient(base),
      details:
        this.testOverrides.details ?? new EtaDocumentDetailsClient(base),
    };
  }

  onModuleInit() {
    if (!this.syncEnabled) return;
    if (!shouldRunInProcessCrons()) {
      this.logger.log('Purchases cron skipped (APP_ROLE=api; worker owns crons)');
      return;
    }
    this.logger.log(
      `Purchases cron sync enabled every ${this.intervalMs}ms`,
    );
    this.cronTimer = setInterval(() => {
      void this.runCronForAllTenants();
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.cronTimer) clearInterval(this.cronTimer);
  }

  setClientsForTests(opts: {
    search?: EtaDocumentsSearchClient;
    recent?: EtaDocumentsRecentClient;
    details?: EtaDocumentDetailsClient;
  }) {
    this.testOverrides = { ...this.testOverrides, ...opts };
  }

  async startManualSync(tenantId: string, triggeredByUserId: string) {
    return this.startSync(tenantId, 'MANUAL', triggeredByUserId);
  }

  async latestSync(tenantId: string) {
    const run = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (!run) {
      return {
        id: null,
        trigger: null,
        status: null,
        fetchedCount: 0,
        newCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errorSummary: null,
        startedAt: null,
        finishedAt: null,
      };
    }
    return this.serializeRun(run);
  }

  private serializeRun(run: {
    id: string;
    trigger: ReceivedSyncTrigger;
    status: string;
    fetchedCount: number;
    newCount: number;
    updatedCount: number;
    skippedCount: number;
    failedCount: number;
    errorSummary: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }) {
    return {
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      fetchedCount: run.fetchedCount,
      newCount: run.newCount,
      updatedCount: run.updatedCount,
      skippedCount: run.skippedCount,
      failedCount: run.failedCount,
      errorSummary: run.errorSummary,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  private async startSync(
    tenantId: string,
    trigger: ReceivedSyncTrigger,
    triggeredByUserId: string | null,
  ) {
    const busy = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.findFirst({
        where: {
          tenantId,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (busy || this.inFlight.has(tenantId)) {
      throw new ConflictException({
        code: 'PURCHASES_SYNC_IN_PROGRESS',
        message: 'A purchases sync is already running for this tenant',
        syncRunId: busy?.id,
      });
    }

    const run = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.create({
        data: {
          tenantId,
          trigger,
          status: 'PENDING',
          triggeredByUserId,
        },
      }),
    );

    this.inFlight.add(tenantId);
    void this.executeRun(tenantId, run.id, triggeredByUserId).finally(() => {
      this.inFlight.delete(tenantId);
    });

    await this.audit.write({
      action: 'purchases.sync.start',
      outcome: 'success',
      actorUserId: triggeredByUserId,
      tenantId,
      resourceType: 'received_document_sync_run',
      resourceId: run.id,
      metadata: { trigger },
    });

    return this.serializeRun(run);
  }

  async executeRun(
    tenantId: string,
    runId: string,
    triggeredByUserId: string | null,
  ) {
    const counters = {
      fetchedCount: 0,
      newCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
    const errors: string[] = [];

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.update({
        where: { id: runId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    try {
      const accessToken = await this.eta.getAccessToken(tenantId);
      const clients = await this.clientsFor(tenantId);
      const etaEnvironment = await this.eta.getActiveEnvironment(tenantId);
      const byUuid = new Map<string, Record<string, unknown>>();

      let token: string | null | undefined = undefined;
      do {
        const page = await clients.search.searchReceived(accessToken, {
          pageSize: 100,
          continuationToken: token || undefined,
        });
        for (const row of page.result) {
          const mapped = mapEtaReceivedRow(row);
          if (!mapped.documentUuid) {
            counters.skippedCount += 1;
            continue;
          }
          byUuid.set(mapped.documentUuid, row);
        }
        token = page.continuationToken;
      } while (token);

      if (this.useRecent) {
        try {
          const recent = await clients.recent.recentReceived(accessToken, {
            pageSize: 100,
          });
          for (const row of recent.result) {
            const mapped = mapEtaReceivedRow(row);
            if (!mapped.documentUuid) {
              counters.skippedCount += 1;
              continue;
            }
            byUuid.set(mapped.documentUuid, row);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Recent documents pull failed: ${msg}`);
          errors.push(`recent: ${msg}`);
        }
      }

      counters.fetchedCount = byUuid.size;

      for (const [uuid, row] of byUuid) {
        try {
          const outcome = await this.upsertOne(
            tenantId,
            accessToken,
            row,
            clients.details,
            etaEnvironment,
          );
          if (outcome === 'new') counters.newCount += 1;
          else if (outcome === 'updated') counters.updatedCount += 1;
          else counters.skippedCount += 1;
        } catch (err) {
          counters.failedCount += 1;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${uuid}: ${msg}`);
        }
      }

      const failed = counters.failedCount > 0 && counters.newCount + counters.updatedCount === 0;
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.receivedDocumentSyncRun.update({
          where: { id: runId },
          data: {
            status: failed ? 'FAILED' : 'SUCCEEDED',
            finishedAt: new Date(),
            ...counters,
            errorSummary: errors.length ? errors.slice(0, 20).join('; ') : null,
          },
        }),
      );

      await this.audit.write({
        action: failed ? 'purchases.sync.failure' : 'purchases.sync.success',
        outcome: failed ? 'failure' : 'success',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'received_document_sync_run',
        resourceId: runId,
        metadata: counters,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.receivedDocumentSyncRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            ...counters,
            errorSummary: message.slice(0, 1000),
          },
        }),
      );
      await this.audit.write({
        action: 'purchases.sync.failure',
        outcome: 'failure',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'received_document_sync_run',
        resourceId: runId,
        metadata: { message },
      });
    }

    return counters;
  }

  private async upsertOne(
    tenantId: string,
    accessToken: string,
    row: Record<string, unknown>,
    detailsClient: EtaDocumentDetailsClient,
    etaEnvironment: 'SANDBOX' | 'PRODUCTION',
  ): Promise<'new' | 'updated' | 'skipped'> {
    const mapped = mapEtaReceivedRow(row);
    if (!mapped.documentUuid) return 'skipped';

    let details: Record<string, unknown> | null = null;
    try {
      details = await detailsClient.getDetails(accessToken, mapped.documentUuid);
    } catch {
      details = null;
    }

    const now = new Date();
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.receivedDocument.findUnique({
        where: {
          tenantId_documentUuid: {
            tenantId,
            documentUuid: mapped.documentUuid!,
          },
        },
      });

      const data = {
        etaLongId: mapped.etaLongId,
        internalId: mapped.internalId,
        etaDocumentType: mapped.etaDocumentType,
        etaDocumentTypeVersion: mapped.etaDocumentTypeVersion,
        kind: mapped.kind,
        etaStatus: mapped.etaStatus,
        dateTimeIssued: mapped.dateTimeIssued,
        issuerType: mapped.issuerType,
        issuerId: mapped.issuerId,
        issuerName: mapped.issuerName,
        issuerJson: mapped.issuerJson ?? undefined,
        receiverJson: mapped.receiverJson ?? undefined,
        currency: mapped.currency,
        totalAmount: mapped.totalAmount,
        netAmount: mapped.netAmount,
        rawSummaryJson: mapped.rawSummaryJson,
        rawDetailsJson: (details ?? undefined) as Prisma.InputJsonValue | undefined,
        etaEnvironment,
        lastSyncedAt: now,
      };

      let docId: string;
      let outcome: 'new' | 'updated';
      if (!existing) {
        const created = await tx.receivedDocument.create({
          data: {
            tenantId,
            documentUuid: mapped.documentUuid!,
            ...data,
          },
        });
        docId = created.id;
        outcome = 'new';
        void this.usageEmit.emitReceived({
          tenantId,
          receivedDocumentId: created.id,
          currencyCode: mapped.currency ?? null,
        });
      } else {
        await tx.receivedDocument.update({
          where: { id: existing.id },
          data,
        });
        docId = existing.id;
        outcome = 'updated';
        await tx.receivedDocumentLine.deleteMany({
          where: { receivedDocumentId: docId },
        });
      }

      if (details) {
        const lines = mapDetailsLines(details);
        if (lines.length) {
          await tx.receivedDocumentLine.createMany({
            data: lines.map((l) => ({
              tenantId,
              receivedDocumentId: docId,
              ...l,
            })),
          });
        }
      }

      return outcome;
    });
  }

  private async runCronForAllTenants() {
    try {
      const tenants = await this.prisma.tenantEtaCredential.findMany({
        select: { tenantId: true },
        distinct: ['tenantId'],
      });
      for (const { tenantId } of tenants) {
        if (this.inFlight.has(tenantId)) continue;
        try {
          await this.startSync(tenantId, 'CRON', null);
        } catch (err) {
          if (err instanceof ConflictException) continue;
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Cron sync skipped for ${tenantId}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Cron sync tick failed: ${msg}`);
    }
  }
}
