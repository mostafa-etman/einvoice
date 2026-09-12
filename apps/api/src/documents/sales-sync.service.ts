import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaDocumentsSearchClient } from '../eta/eta-documents-search.client';
import { EtaDocumentDetailsClient } from '../eta/eta-document-details.client';
import { mapEtaIssuedDetailsToImport } from './issued-document-import.mapper';
import type { IssuedImportMapped } from './issued-document-import.mapper';
import { mapEtaStatusToLocal, shouldApplyMappedEtaStatus } from '../eta/eta-status-map';
import { extractEtaDocumentStatus } from '../eta/eta-submission-status.client';
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
  createRequestStartPacer,
  ETA_RATE_LIMIT_MESSAGE,
  isEtaRateLimitError,
} from '../eta/eta-rate-limit';
import { ETA_DOCUMENTS_SEARCH_PAGE_SIZE } from '../eta/eta-documents-search.client';
import {
  etaSyncDetailsConcurrency,
  mapPool,
} from '../sync/async-pool';

function taxTotalsStored(json: unknown): boolean {
  return Array.isArray(json) && json.length > 0;
}

/** ETA_SYNC rows that were imported as DRAFT / without taxes must be rewritten. */
export function etaSyncIssuedNeedsBackfill(existing: {
  origin: string;
  status: string;
  taxTotalsJson?: unknown;
  lineCount: number;
  hasLineTax: boolean;
}): boolean {
  if (existing.origin !== 'ETA_SYNC') return false;
  if (existing.status === 'DRAFT') return true;
  if (existing.lineCount <= 0) return true;
  if (!existing.hasLineTax && !taxTotalsStored(existing.taxTotalsJson)) {
    return true;
  }
  return false;
}

type IssuedExistingPeek = {
  id: string;
  etaUuid: string | null;
  origin: string;
  internalId: string;
  status: string;
  issueDateTime: Date;
  taxTotalsJson: unknown;
  _count: { lines: number };
  lines: Array<{ taxes: Array<{ id: string }> }>;
};

const ISSUED_EXISTING_SELECT = {
  id: true,
  etaUuid: true,
  origin: true,
  internalId: true,
  status: true,
  issueDateTime: true,
  taxTotalsJson: true,
  _count: { select: { lines: true } },
  lines: {
    take: 1,
    select: { taxes: { take: 1, select: { id: true } } },
  },
} as const;

function issuedNeedsEtaDetails(
  existing: IssuedExistingPeek | null | undefined,
  row: Record<string, unknown>,
): boolean {
  if (!existing) return true;
  if (existing.origin !== 'ETA_SYNC') return false;
  return (
    etaSyncIssuedNeedsBackfill({
      origin: existing.origin,
      status: existing.status,
      taxTotalsJson: existing.taxTotalsJson,
      lineCount: existing._count.lines,
      hasLineTax: existing.lines.some((l) => l.taxes.length > 0),
    }) || etaSyncIssuedPeriodDiffers(existing.issueDateTime, row)
  );
}

function formatSalesSyncElapsed(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function etaSearchRowIssueDate(
  row: Record<string, unknown>,
): Date | null {
  const raw =
    row.dateTimeIssued ??
    row.DateTimeIssued ??
    row.issueDate ??
    row.IssueDate;
  if (raw == null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function etaSearchRowInternalId(row: Record<string, unknown>): string {
  return String(
    row.internalId ?? row.InternalId ?? row.internalID ?? '',
  ).trim();
}

/**
 * Detects a stolen/mismatched ETA_SYNC row: same uuid, but stored issue
 * month/year disagrees with the current ETA search row. Invoice number is
 * never used as identity.
 */
export function etaSyncIssuedPeriodDiffers(
  storedIssueDateTime: Date,
  searchRow: Record<string, unknown>,
): boolean {
  const search = etaSearchRowIssueDate(searchRow);
  if (!search) return false;
  return (
    storedIssueDateTime.getUTCFullYear() !== search.getUTCFullYear() ||
    storedIssueDateTime.getUTCMonth() !== search.getUTCMonth()
  );
}

@Injectable()
export class SalesSyncService {
  private readonly logger = new Logger(SalesSyncService.name);
  private readonly inFlight = new Set<string>();
  private testOverrides: {
    search?: EtaDocumentsSearchClient;
    details?: EtaDocumentDetailsClient;
  } = {};

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eta: EtaService,
    private readonly audit: AuditService,
  ) {}

  setClientsForTests(opts: {
    search?: EtaDocumentsSearchClient;
    details?: EtaDocumentDetailsClient;
  }) {
    this.testOverrides = { ...this.testOverrides, ...opts };
  }

  private async clientsFor(tenantId: string) {
    const base = await this.eta.getApiBaseUrl(tenantId);
    return {
      search:
        this.testOverrides.search ?? new EtaDocumentsSearchClient(base),
      details:
        this.testOverrides.details ?? new EtaDocumentDetailsClient(base),
    };
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
      action: 'sales.sync.reset',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'issued_document_sync_run',
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
      tx.issuedDocumentSyncRun.findFirst({
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
    trigger: string;
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

  /** Mark stale PENDING/RUNNING rows FAILED so a new sync can start. */
  private async expireStaleRuns(tenantId: string): Promise<number> {
    const open = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.issuedDocumentSyncRun.findMany({
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
      tx.issuedDocumentSyncRun.updateMany({
        where: { id: { in: staleIds } },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorSummary: SYNC_STALE_ERROR.slice(0, 1000),
        },
      }),
    );
    this.logger.warn(
      `Sales sync stale lock released for ${tenantId}: ${staleIds.length} run(s)`,
    );
    // If every open run was stale, clear memory lock (process may have died).
    if (staleIds.length === open.length) this.inFlight.delete(tenantId);
    return staleIds.length;
  }

  private async failOpenRuns(
    tenantId: string,
    message: string,
  ): Promise<number> {
    const result = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.issuedDocumentSyncRun.updateMany({
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
    trigger: 'MANUAL' | 'CRON',
    triggeredByUserId: string | null,
    rangeInput?: SyncDateRangeInput,
  ) {
    await this.expireStaleRuns(tenantId);

    const busy = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.issuedDocumentSyncRun.findFirst({
        where: {
          tenantId,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );

    // Memory lock without a live DB run = orphan after crash; clear it.
    if (this.inFlight.has(tenantId) && !busy) {
      this.inFlight.delete(tenantId);
    }

    if (busy || this.inFlight.has(tenantId)) {
      throw new ConflictException({
        code: 'SALES_SYNC_IN_PROGRESS',
        message: 'A sales sync is already running for this tenant',
        syncRunId: busy?.id,
        staleAfterMs: SYNC_STALE_MS,
        hint: 'POST /documents/sync/reset to cancel a stuck sync',
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
      tx.issuedDocumentSyncRun.create({
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
      action: 'sales.sync.start',
      outcome: 'success',
      actorUserId: triggeredByUserId,
      tenantId,
      resourceType: 'issued_document_sync_run',
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
    let searchIncomplete = false;
    const startedMs = Date.now();
    let pagesProcessed = 0;
    let detailsFetched = 0;
    let retryCount = 0;

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.issuedDocumentSyncRun.update({
        where: { id: runId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    try {
      // Cached per tenant — reused for the whole run (refresh only if near expiry).
      let accessToken = await this.eta.getAccessToken(tenantId);
      const clients = await this.clientsFor(tenantId);
      const etaEnvironment = await this.eta.getActiveEnvironment(tenantId);

      const range =
        rangeOverride ?? (await this.resolveSyncRange(tenantId));
      const windows = syncSearchWindows(range.from, range.to);
      const detailsConcurrency = etaSyncDetailsConcurrency();
      const pacer = createRequestStartPacer();
      const branch = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.branch.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        }),
      );
      if (!branch) {
        throw new Error('No active branch to attach imported sales document');
      }

      this.logger.log(
        `Sales sync start tenant=${tenantId} range=${range.from.toISOString()}..${range.to.toISOString()} windows=${windows.length} pageSize=${ETA_DOCUMENTS_SEARCH_PAGE_SIZE} detailsConcurrency=${detailsConcurrency}`,
      );

      const discoveredUuids = new Set<string>();
      let detailIndex = 0;
      const onRetry = () => {
        retryCount += 1;
      };

      for (let w = 0; w < windows.length; w++) {
        const win = windows[w]!;
        const windowStartedMs = Date.now();
        let windowDetails = 0;
        let windowPersisted = 0;

        const collected = await collectEtaSearchRows({
          windows: [win],
          onRetry,
          searchPage: async ({ continuationToken, window }) => {
            accessToken = await this.eta.getAccessToken(tenantId);
            return clients.search.searchSent(accessToken, {
              pageSize: ETA_DOCUMENTS_SEARCH_PAGE_SIZE,
              continuationToken,
              window: {
                from: window.from,
                to: window.to,
                dateField: ETA_SYNC_DATE_FIELD,
              },
            });
          },
          onPage: async ({ newRows, pageNumber }) => {
            const existingByUuid = await this.loadExistingIssued(
              tenantId,
              newRows.map(([uuid]) => uuid),
            );
            await mapPool(newRows, detailsConcurrency, async ([uuid, row]) => {
              try {
                detailIndex += 1;
                if (detailIndex % 25 === 0) {
                  accessToken = await this.eta.getAccessToken(tenantId);
                }
                const existing = existingByUuid.get(uuid) ?? null;
                if (issuedNeedsEtaDetails(existing, row)) {
                  await pacer();
                  detailsFetched += 1;
                  windowDetails += 1;
                }
                const outcome = await retryOnEtaRateLimit(
                  () =>
                    this.upsertIssued(
                      tenantId,
                      accessToken,
                      row,
                      clients.details,
                      etaEnvironment,
                      { existing, branchId: branch.id },
                    ),
                  { skipInitialPace: true, onRetry },
                );
                windowPersisted += 1;
                if (outcome === 'new') counters.newCount += 1;
                else if (outcome === 'updated') counters.updatedCount += 1;
                else counters.skippedCount += 1;
              } catch (err) {
                counters.failedCount += 1;
                if (isEtaRateLimitError(err)) {
                  rateLimited = true;
                  errors.push(`${uuid}: ${ETA_RATE_LIMIT_MESSAGE}`);
                  return;
                }
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`${uuid}: ${msg}`);
              }
            });
            if (rateLimited) {
              const err = new Error(ETA_RATE_LIMIT_MESSAGE) as Error & {
                status?: number;
              };
              err.status = 429;
              throw err;
            }
            this.logger.log(
              `Sales sync: Window ${w + 1}/${windows.length} page ${pageNumber} ` +
                `Discovered: ${newRows.length} Persisted: ${windowPersisted} ` +
                `Elapsed: ${formatSalesSyncElapsed(Date.now() - windowStartedMs)}`,
            );
          },
        });

        pagesProcessed += collected.pagesProcessed;
        counters.skippedCount += collected.skippedCount;
        for (const uuid of collected.byUuid.keys()) discoveredUuids.add(uuid);
        counters.fetchedCount = discoveredUuids.size;
        if (collected.searchIncomplete) {
          searchIncomplete = true;
          rateLimited =
            rateLimited ||
            collected.errors.some((e) => /rate limit/i.test(e));
          errors.push(...collected.errors);
        }

        this.logger.log(
          `Sales sync: Window ${w + 1}/${windows.length} ` +
            `Pages: ${collected.pagesProcessed} ` +
            `Discovered: ${collected.byUuid.size} ` +
            `Persisted: ${windowPersisted} ` +
            `Details: ${windowDetails} ` +
            `Elapsed: ${formatSalesSyncElapsed(Date.now() - windowStartedMs)}`,
        );

        if (searchIncomplete || rateLimited) break;
      }

      counters.fetchedCount = discoveredUuids.size;
      const imported = counters.newCount + counters.updatedCount;
      const incomplete =
        searchIncomplete || counters.failedCount > 0 || rateLimited;
      const summaryParts = [
        ...errors.slice(0, 15),
        incomplete && imported > 0
          ? `Incomplete sync (partial: ${imported} saved; retry to resume)`
          : null,
      ].filter(Boolean) as string[];
      const elapsed = formatSalesSyncElapsed(Date.now() - startedMs);
      const finalStatus = incomplete ? 'FAILED' : 'SUCCEEDED';

      this.logger.log(
        `Sales sync ${incomplete ? 'failed' : 'completed'} tenant=${tenantId} ` +
          `Windows: ${windows.length} Pages: ${pagesProcessed} ` +
          `Discovered: ${counters.fetchedCount} Persisted: ${imported} ` +
          `Details: ${detailsFetched} Retries: ${retryCount} ` +
          `Elapsed: ${elapsed} Status: ${finalStatus}`,
      );

      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.issuedDocumentSyncRun.update({
          where: { id: runId },
          data: {
            status: finalStatus,
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
        action: incomplete ? 'sales.sync.failure' : 'sales.sync.success',
        outcome: incomplete ? 'failure' : 'success',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'issued_document_sync_run',
        resourceId: runId,
        metadata: {
          ...counters,
          rateLimited,
          searchIncomplete,
          pagesProcessed,
          detailsFetched,
          retryCount,
          windowCount: windows.length,
          detailsConcurrency,
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
        tx.issuedDocumentSyncRun.update({
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
      this.logger.warn(
        `Sales sync failed tenant=${tenantId} Discovered: ${counters.fetchedCount} ` +
          `Persisted: ${imported} Elapsed: ${formatSalesSyncElapsed(Date.now() - startedMs)} ` +
          `Retries: ${retryCount} Status: FAILED`,
      );
      await this.audit.write({
        action: 'sales.sync.failure',
        outcome: 'failure',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'issued_document_sync_run',
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
    // Do not auto-expand to multi-year history — user can pick a wider range.
    if (
      firstValid?.issueDateTime &&
      firstValid.issueDateTime.getTime() > fallback.from.getTime() &&
      firstValid.issueDateTime.getTime() < fallback.to.getTime()
    ) {
      return { from: new Date(firstValid.issueDateTime), to: fallback.to };
    }
    return fallback;
  }

  private async loadExistingIssued(
    tenantId: string,
    uuids: string[],
  ): Promise<Map<string, IssuedExistingPeek>> {
    const out = new Map<string, IssuedExistingPeek>();
    if (uuids.length === 0) return out;
    const chunkSize = ETA_DOCUMENTS_SEARCH_PAGE_SIZE;
    for (let i = 0; i < uuids.length; i += chunkSize) {
      const slice = uuids.slice(i, i + chunkSize);
      const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.findMany({
          where: { tenantId, etaUuid: { in: slice } },
          select: ISSUED_EXISTING_SELECT,
        }),
      );
      for (const row of rows) {
        if (row.etaUuid) out.set(row.etaUuid, row);
      }
    }
    return out;
  }

  private async upsertIssued(
    tenantId: string,
    accessToken: string,
    row: Record<string, unknown>,
    detailsClient: EtaDocumentDetailsClient,
    etaEnvironment: 'SANDBOX' | 'PRODUCTION',
    opts?: {
      existing?: IssuedExistingPeek | null;
      branchId?: string;
    },
  ): Promise<'new' | 'updated' | 'skipped'> {
    const uuid = String(
      row.uuid ?? row.UUID ?? row.documentUUID ?? row.documentUuid ?? '',
    ).trim();
    if (!uuid) return 'skipped';

    const existing =
      opts && 'existing' in opts
        ? (opts.existing ?? null)
        : await this.tenantPrisma.withTenant(tenantId, (tx) =>
            tx.document.findUnique({
              where: { tenantId_etaUuid: { tenantId, etaUuid: uuid } },
              select: ISSUED_EXISTING_SELECT,
            }),
          );

    // Local / file-imported docs that already have this ETA uuid: refresh status only.
    if (existing && existing.origin !== 'ETA_SYNC') {
      await this.refreshLocalIssuedStatus(tenantId, existing.id, row);
      return 'updated';
    }

    const needsBackfill = issuedNeedsEtaDetails(existing, row);

    // Already imported complete — status-only refresh (resume-friendly).
    if (existing && !needsBackfill) {
      await this.refreshLocalIssuedStatus(tenantId, existing.id, row);
      return 'skipped';
    }

    let details: Record<string, unknown>;
    try {
      details = await detailsClient.getDetails(accessToken, uuid);
    } catch (err) {
      if (existing) {
        await this.refreshLocalIssuedStatus(tenantId, existing.id, row);
        return 'updated';
      }
      throw err;
    }

    const mapped = mapEtaIssuedDetailsToImport(row, details);
    if (!mapped) return 'skipped';

    if (existing) {
      await this.replaceEtaSyncDocument(tenantId, existing.id, mapped);
      return 'updated';
    }

    // Identity is ETA uuid only. Same invoice number in another period is a
    // different document and must be created, never merged.
    const branchId =
      opts?.branchId ??
      (
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.branch.findFirst({
            where: { tenantId, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          }),
        )
      )?.id;
    if (!branchId) {
      throw new Error('No active branch to attach imported sales document');
    }

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.document.create({
        data: {
          tenantId,
          kind: mapped.kind,
          status: mapped.status,
          origin: 'ETA_SYNC',
          branchId,
          currencyCode: mapped.currencyCode,
          issueDateTime: mapped.issueDateTime,
          internalId: mapped.internalId,
          etaDocumentType: mapped.etaDocumentType,
          etaDocumentTypeVersion: mapped.etaDocumentTypeVersion,
          typeVersionFetchedAt: new Date(),
          receiverType: mapped.receiverType,
          receiverId: mapped.receiverId,
          receiverName: mapped.receiverName,
          receiverAddressJson: mapped.receiverAddressJson ?? undefined,
          issuerSnapshotJson: mapped.issuerSnapshot,
          extraDiscountAmount: mapped.extraDiscountAmount,
          totalSalesAmount: mapped.totalSalesAmount,
          totalDiscountAmount: mapped.totalDiscountAmount,
          netAmount: mapped.netAmount,
          totalAmount: mapped.totalAmount,
          totalItemsDiscountAmount: mapped.totalItemsDiscountAmount,
          taxTotalsJson: mapped.taxTotalsJson,
          etaPayloadJson: mapped.etaPayloadJson,
          signaturesJson: mapped.signaturesJson ?? undefined,
          signedAt: mapped.signaturesJson ? mapped.issueDateTime : undefined,
          etaUuid: mapped.etaUuid,
          etaLongId: mapped.etaLongId,
          etaStatus: mapped.etaStatus,
          etaStatusUpdatedAt: new Date(),
          etaEnvironment,
          version: 1,
          lines: {
            create: this.lineCreates(tenantId, mapped),
          },
        },
      });
    });

    return 'new';
  }

  private lineCreates(tenantId: string, mapped: IssuedImportMapped) {
    return mapped.lines.map((l) => ({
      tenantId,
      lineNumber: l.lineNumber,
      description: l.description,
      itemType: l.itemType,
      itemCode: l.itemCode,
      unitType: l.unitType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      currencySold: l.currencySold,
      amountSold: l.amountSold,
      amountEgp: l.amountEgp,
      currencyExchangeRate: l.currencyExchangeRate,
      discountRate: l.discountRate,
      discountAmount: l.discountAmount,
      salesTotal: l.salesTotal,
      netTotal: l.netTotal,
      total: l.total,
      valueDifference: l.valueDifference,
      totalTaxableFees: l.totalTaxableFees,
      itemsDiscount: l.itemsDiscount,
      internalCode: l.internalCode,
      taxes: {
        create: l.taxes.map((t) => ({
          tenantId,
          taxType: t.taxType,
          subType: t.subType,
          rate: t.rate,
          amount: t.amount,
        })),
      },
    }));
  }

  private async replaceEtaSyncDocument(
    tenantId: string,
    documentId: string,
    mapped: IssuedImportMapped,
  ) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.documentLine.deleteMany({ where: { documentId } });
      await tx.document.update({
        where: { id: documentId },
        data: {
          origin: 'ETA_SYNC',
          kind: mapped.kind,
          status: mapped.status,
          currencyCode: mapped.currencyCode,
          issueDateTime: mapped.issueDateTime,
          internalId: mapped.internalId,
          etaDocumentType: mapped.etaDocumentType,
          etaDocumentTypeVersion: mapped.etaDocumentTypeVersion,
          typeVersionFetchedAt: new Date(),
          receiverType: mapped.receiverType,
          receiverId: mapped.receiverId,
          receiverName: mapped.receiverName,
          receiverAddressJson: mapped.receiverAddressJson ?? undefined,
          issuerSnapshotJson: mapped.issuerSnapshot,
          extraDiscountAmount: mapped.extraDiscountAmount,
          totalSalesAmount: mapped.totalSalesAmount,
          totalDiscountAmount: mapped.totalDiscountAmount,
          netAmount: mapped.netAmount,
          totalAmount: mapped.totalAmount,
          totalItemsDiscountAmount: mapped.totalItemsDiscountAmount,
          taxTotalsJson: mapped.taxTotalsJson,
          etaPayloadJson: mapped.etaPayloadJson,
          signaturesJson: mapped.signaturesJson ?? undefined,
          signedAt: mapped.signaturesJson ? mapped.issueDateTime : undefined,
          etaLongId: mapped.etaLongId,
          etaStatus: mapped.etaStatus,
          etaStatusUpdatedAt: new Date(),
          lines: { create: this.lineCreates(tenantId, mapped) },
        },
      });
    });
  }

  private async refreshLocalIssuedStatus(
    tenantId: string,
    documentId: string,
    row: Record<string, unknown>,
  ) {
    const uuid = String(
      row.uuid ?? row.UUID ?? row.documentUUID ?? row.documentUuid ?? '',
    ).trim();
    const longId = String(
      row.longId ?? row.LongId ?? row.longID ?? '',
    ).trim();
    const searchInternalId = etaSearchRowInternalId(row);
    const etaStatusRaw = extractEtaDocumentStatus(row) ?? '';
    const mapped = mapEtaStatusToLocal(etaStatusRaw);

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const current = await tx.document.findFirst({
        where: { id: documentId, tenantId },
        select: { status: true, origin: true, internalId: true },
      });
      const applyStatus =
        mapped &&
        current &&
        shouldApplyMappedEtaStatus(current.status, mapped);
      const restoreInternalId =
        current?.origin === 'ETA_SYNC' &&
        searchInternalId.length > 0 &&
        searchInternalId !== current.internalId;
      await tx.document.update({
        where: { id: documentId },
        data: {
          ...(uuid ? { etaUuid: uuid } : {}),
          ...(longId ? { etaLongId: longId } : {}),
          ...(etaStatusRaw ? { etaStatus: etaStatusRaw } : {}),
          ...(applyStatus ? { status: mapped } : {}),
          ...(restoreInternalId ? { internalId: searchInternalId } : {}),
          etaStatusUpdatedAt: new Date(),
        },
      });
    });
  }
}
