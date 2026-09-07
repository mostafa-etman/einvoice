import {
  BadRequestException,
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
import {
  isSyncRunStale,
  SYNC_RESET_ERROR,
  SYNC_STALE_ERROR,
  SYNC_STALE_MS,
} from '../sync/sync-lock';
import {
  DEFAULT_SYNC_LOOKBACK_DAYS,
  defaultLookbackRange,
  parseSyncDateRange,
  type SyncDateRange,
  type SyncDateRangeInput,
} from '../sync/sync-range';
import {
  collectEtaSearchRows,
  ETA_SYNC_DATE_FIELD,
  retryOnEtaRateLimit,
  syncSearchWindows,
} from '../sync/eta-sync-collect';
import {
  ETA_RATE_LIMIT_MESSAGE,
  isEtaRateLimitError,
  paceEtaSyncRequest,
} from '../eta/eta-rate-limit';

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

  async startManualSync(
    tenantId: string,
    triggeredByUserId: string,
    range?: SyncDateRangeInput,
  ) {
    return this.startSync(tenantId, 'MANUAL', triggeredByUserId, range);
  }

  /** Force-fail any PENDING/RUNNING runs and clear the in-memory lock. */
  async resetStuckSync(tenantId: string, actorUserId: string) {
    const released = await this.failOpenRuns(tenantId, SYNC_RESET_ERROR);
    this.inFlight.delete(tenantId);
    await this.audit.write({
      action: 'purchases.sync.reset',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'received_document_sync_run',
      metadata: { releasedCount: released },
    });
    return {
      releasedCount: released,
      latest: await this.latestSync(tenantId),
    };
  }

  async latestSync(tenantId: string) {
    await this.expireStaleRuns(tenantId);
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

  private async expireStaleRuns(tenantId: string): Promise<number> {
    const open = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.findMany({
        where: { tenantId, status: { in: ['PENDING', 'RUNNING'] } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          startedAt: true,
        },
      }),
    );
    const staleIds = open.filter((r) => isSyncRunStale(r)).map((r) => r.id);
    if (!staleIds.length) return 0;
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.updateMany({
        where: { id: { in: staleIds } },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorSummary: SYNC_STALE_ERROR.slice(0, 1000),
        },
      }),
    );
    this.logger.warn(
      `Purchases sync stale lock released for ${tenantId}: ${staleIds.length} run(s)`,
    );
    if (staleIds.length === open.length) this.inFlight.delete(tenantId);
    return staleIds.length;
  }

  private async failOpenRuns(
    tenantId: string,
    message: string,
  ): Promise<number> {
    const result = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.updateMany({
        where: { tenantId, status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorSummary: message.slice(0, 1000),
        },
      }),
    );
    return result.count;
  }

  private async startSync(
    tenantId: string,
    trigger: ReceivedSyncTrigger,
    triggeredByUserId: string | null,
    rangeInput?: SyncDateRangeInput,
  ) {
    await this.expireStaleRuns(tenantId);

    const busy = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.findFirst({
        where: {
          tenantId,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );

    if (this.inFlight.has(tenantId) && !busy) {
      this.inFlight.delete(tenantId);
    }

    if (busy || this.inFlight.has(tenantId)) {
      throw new ConflictException({
        code: 'PURCHASES_SYNC_IN_PROGRESS',
        message: 'A purchases sync is already running for this tenant',
        syncRunId: busy?.id,
        staleAfterMs: SYNC_STALE_MS,
        hint: 'POST /purchases/sync/reset to cancel a stuck sync',
      });
    }

    let resolvedRange: SyncDateRange;
    try {
      resolvedRange = await this.resolveSyncRange(tenantId, rangeInput);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid sync date range',
      );
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
    void this.executeRun(
      tenantId,
      run.id,
      triggeredByUserId,
      resolvedRange,
    ).finally(() => {
      this.inFlight.delete(tenantId);
    });

    await this.audit.write({
      action: 'purchases.sync.start',
      outcome: 'success',
      actorUserId: triggeredByUserId,
      tenantId,
      resourceType: 'received_document_sync_run',
      resourceId: run.id,
      metadata: {
        trigger,
        rangeFrom: resolvedRange.from.toISOString(),
        rangeTo: resolvedRange.to.toISOString(),
      },
    });

    return this.serializeRun(run);
  }

  async executeRun(
    tenantId: string,
    runId: string,
    triggeredByUserId: string | null,
    rangeOverride?: SyncDateRange,
  ) {
    const counters = {
      fetchedCount: 0,
      newCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
    const errors: string[] = [];
    let rateLimited = false;

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocumentSyncRun.update({
        where: { id: runId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    try {
      let accessToken = await this.eta.getAccessToken(tenantId);
      const clients = await this.clientsFor(tenantId);
      const etaEnvironment = await this.eta.getActiveEnvironment(tenantId);
      const byUuid = new Map<string, Record<string, unknown>>();

      const range =
        rangeOverride ?? (await this.resolveSyncRange(tenantId));
      const windows = syncSearchWindows(range.from, range.to);
      this.logger.log(
        `Purchases sync ${tenantId} windows=${windows.length} from=${range.from.toISOString()} to=${range.to.toISOString()} dateField=${ETA_SYNC_DATE_FIELD}`,
      );

      const collected = await collectEtaSearchRows({
        windows,
        uuidOf: (row) => mapEtaReceivedRow(row).documentUuid ?? '',
        searchPage: async ({ continuationToken, window }) => {
          accessToken = await this.eta.getAccessToken(tenantId);
          return clients.search.searchReceived(accessToken, {
            pageSize: 100,
            continuationToken,
            window: {
              from: window.from,
              to: window.to,
              dateField: ETA_SYNC_DATE_FIELD,
            },
          });
        },
      });
      for (const [uuid, row] of collected.byUuid) byUuid.set(uuid, row);
      counters.skippedCount += collected.skippedCount;
      if (collected.searchIncomplete) {
        rateLimited = true;
        errors.push(...collected.errors);
      }

      if (this.useRecent && !collected.searchIncomplete) {
        try {
          const recent = await retryOnEtaRateLimit(async () => {
            accessToken = await this.eta.getAccessToken(tenantId);
            return clients.recent.recentReceived(accessToken, {
              pageSize: 100,
            });
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
          if (isEtaRateLimitError(err)) {
            rateLimited = true;
            errors.push(`recent: ${ETA_RATE_LIMIT_MESSAGE}`);
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Recent documents pull failed: ${msg}`);
            errors.push(`recent: ${msg}`);
          }
        }
      }

      counters.fetchedCount = byUuid.size;

      let detailIndex = 0;
      for (const [uuid, row] of byUuid) {
        try {
          detailIndex += 1;
          if (detailIndex % 25 === 0) {
            accessToken = await this.eta.getAccessToken(tenantId);
          }
          const outcome = await retryOnEtaRateLimit(() =>
            this.upsertOne(
              tenantId,
              accessToken,
              row,
              clients.details,
              etaEnvironment,
            ),
          );
          if (outcome === 'new') counters.newCount += 1;
          else if (outcome === 'updated') counters.updatedCount += 1;
          else counters.skippedCount += 1;
        } catch (err) {
          counters.failedCount += 1;
          if (isEtaRateLimitError(err)) {
            rateLimited = true;
            errors.push(`${uuid}: ${ETA_RATE_LIMIT_MESSAGE}`);
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${uuid}: ${msg}`);
        }
      }

      const imported = counters.newCount + counters.updatedCount;
      const incomplete =
        collected.searchIncomplete || counters.failedCount > 0;
      const summaryParts = [
        ...errors.slice(0, 15),
        incomplete && imported > 0
          ? `Incomplete sync (partial: ${imported} saved; retry to resume)`
          : null,
      ].filter(Boolean) as string[];

      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.receivedDocumentSyncRun.update({
          where: { id: runId },
          data: {
            status: incomplete ? 'FAILED' : 'SUCCEEDED',
            finishedAt: new Date(),
            ...counters,
            errorSummary: summaryParts.length
              ? summaryParts.join('; ').slice(0, 1000)
              : rateLimited
                ? ETA_RATE_LIMIT_MESSAGE
                : null,
          },
        }),
      );

      await this.audit.write({
        action: incomplete ? 'purchases.sync.failure' : 'purchases.sync.success',
        outcome: incomplete ? 'failure' : 'success',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'received_document_sync_run',
        resourceId: runId,
        metadata: {
          ...counters,
          rateLimited,
          searchIncomplete: collected.searchIncomplete,
          rangeFrom: range.from.toISOString(),
          rangeTo: range.to.toISOString(),
        },
      });
    } catch (err) {
      const message = isEtaRateLimitError(err)
        ? ETA_RATE_LIMIT_MESSAGE
        : err instanceof Error
          ? err.message
          : String(err);
      const imported = counters.newCount + counters.updatedCount;
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.receivedDocumentSyncRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            ...counters,
            errorSummary: (
              imported > 0
                ? `${message} (partial: ${imported} saved; retry to resume)`
                : message
            ).slice(0, 1000),
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
        metadata: { message, ...counters },
      });
    }

    return counters;
  }

  /**
   * Prefer explicit UI range; else last DEFAULT_SYNC_LOOKBACK_DAYS.
   * Older history is not auto-expanded — pick the VAT period in the UI.
   */
  private async resolveSyncRange(
    tenantId: string,
    rangeInput?: SyncDateRangeInput,
  ): Promise<SyncDateRange> {
    const fallback = defaultLookbackRange(DEFAULT_SYNC_LOOKBACK_DAYS);
    if (rangeInput?.from || rangeInput?.to) {
      return parseSyncDateRange(rangeInput, fallback);
    }

    const firstValid = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({
        where: { tenantId, status: 'VALID' },
        orderBy: { issueDateTime: 'asc' },
        select: { issueDateTime: true },
      }),
    );
    if (
      firstValid?.issueDateTime &&
      firstValid.issueDateTime.getTime() > fallback.from.getTime() &&
      firstValid.issueDateTime.getTime() < fallback.to.getTime()
    ) {
      return { from: new Date(firstValid.issueDateTime), to: fallback.to };
    }
    return fallback;
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

    const existingPeek = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.findUnique({
        where: {
          tenantId_documentUuid: {
            tenantId,
            documentUuid: mapped.documentUuid!,
          },
        },
        select: { id: true, rawDetailsJson: true },
      }),
    );

    // Already imported with details — refresh summary only (no ETA details call).
    if (existingPeek?.rawDetailsJson) {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.receivedDocument.update({
          where: { id: existingPeek.id },
          data: {
            etaStatus: mapped.etaStatus,
            etaLongId: mapped.etaLongId,
            internalId: mapped.internalId,
            totalAmount: mapped.totalAmount,
            netAmount: mapped.netAmount,
            lastSyncedAt: new Date(),
            rawSummaryJson: mapped.rawSummaryJson,
          },
        }),
      );
      return 'skipped';
    }

    let details: Record<string, unknown> | null = null;
    try {
      await paceEtaSyncRequest();
      details = await detailsClient.getDetails(
        accessToken,
        mapped.documentUuid,
      );
    } catch (err) {
      if (isEtaRateLimitError(err)) throw err;
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
