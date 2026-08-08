import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import {
  buildEtaSearchWindows,
  EtaDocumentsSearchClient,
} from '../eta/eta-documents-search.client';
import { EtaDocumentDetailsClient } from '../eta/eta-document-details.client';
import {
  ETA_STATUS_TO_LOCAL,
  mapEtaIssuedDetailsToImport,
} from './issued-document-import.mapper';
import {
  isSyncRunStale,
  SYNC_RESET_ERROR,
  SYNC_STALE_ERROR,
  SYNC_STALE_MS,
} from '../sync/sync-lock';
import {
  DEFAULT_SYNC_LOOKBACK_DAYS,
  defaultLookbackRange,
  MAX_SYNC_WINDOWS,
  parseSyncDateRange,
  type SyncDateRange,
  type SyncDateRangeInput,
} from '../sync/sync-range';
import {
  ETA_RATE_LIMIT_MESSAGE,
  isEtaRateLimitError,
  paceEtaSyncRequest,
} from '../eta/eta-rate-limit';

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
      const byUuid = new Map<string, Record<string, unknown>>();

      const range =
        rangeOverride ?? (await this.resolveSyncRange(tenantId));
      const windows = buildEtaSearchWindows(range.from, range.to).slice(
        -MAX_SYNC_WINDOWS,
      );
      this.logger.log(
        `Sales sync ${tenantId} windows=${windows.length} from=${range.from.toISOString()} to=${range.to.toISOString()}`,
      );

      for (const win of windows) {
        // Reuse cache; cheap if token still valid.
        accessToken = await this.eta.getAccessToken(tenantId);
        let token: string | null | undefined = undefined;
        try {
          do {
            await paceEtaSyncRequest();
            const page = await clients.search.searchSent(accessToken, {
              pageSize: 100,
              continuationToken: token || undefined,
              window: { from: win.from, to: win.to, dateField: 'submission' },
            });
            for (const row of page.result) {
              const uuid = String(
                row.uuid ??
                  row.UUID ??
                  row.documentUUID ??
                  row.documentUuid ??
                  '',
              ).trim();
              if (!uuid) {
                counters.skippedCount += 1;
                continue;
              }
              byUuid.set(uuid, row);
            }
            token = page.continuationToken;
          } while (token);
        } catch (err) {
          if (isEtaRateLimitError(err)) {
            rateLimited = true;
            errors.push(ETA_RATE_LIMIT_MESSAGE);
            this.logger.warn(
              `Sales sync rate-limited during search; continuing with ${byUuid.size} uuid(s) collected`,
            );
            break;
          }
          throw err;
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
          const outcome = await this.upsertIssued(
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
          if (isEtaRateLimitError(err)) {
            rateLimited = true;
            errors.push(`${uuid}: ${ETA_RATE_LIMIT_MESSAGE}`);
            // Keep going — later UUIDs may already be local (skip details).
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${uuid}: ${msg}`);
        }
      }

      const imported = counters.newCount + counters.updatedCount;
      const failed =
        !rateLimited &&
        counters.failedCount > 0 &&
        imported === 0 &&
        byUuid.size > 0;
      const summaryParts = [
        ...errors.slice(0, 15),
        rateLimited && imported > 0
          ? `${ETA_RATE_LIMIT_MESSAGE} (partial: ${imported} saved)`
          : null,
      ].filter(Boolean) as string[];

      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.issuedDocumentSyncRun.update({
          where: { id: runId },
          data: {
            status: failed ? 'FAILED' : 'SUCCEEDED',
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
        action: failed ? 'sales.sync.failure' : 'sales.sync.success',
        outcome: failed ? 'failure' : 'success',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'issued_document_sync_run',
        resourceId: runId,
        metadata: {
          ...counters,
          rateLimited,
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
            // Partial imports stay; mark SUCCEEDED when something was saved.
            status: imported > 0 ? 'SUCCEEDED' : 'FAILED',
            finishedAt: new Date(),
            ...counters,
            errorSummary: (
              imported > 0
                ? `${message} (partial: ${imported} saved)`
                : message
            ).slice(0, 1000),
          },
        }),
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
   * Prefer explicit UI range; else last DEFAULT_SYNC_LOOKBACK_DAYS
   * (or earlier if first local VALID is older — still capped by MAX_SYNC_WINDOWS).
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

  private async upsertIssued(
    tenantId: string,
    accessToken: string,
    row: Record<string, unknown>,
    detailsClient: EtaDocumentDetailsClient,
    etaEnvironment: 'SANDBOX' | 'PRODUCTION',
  ): Promise<'new' | 'updated' | 'skipped'> {
    const uuid = String(
      row.uuid ?? row.UUID ?? row.documentUUID ?? row.documentUuid ?? '',
    ).trim();
    if (!uuid) return 'skipped';

    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({
        where: { tenantId, etaUuid: uuid },
        select: {
          id: true,
          origin: true,
          internalId: true,
          _count: { select: { lines: true } },
        },
      }),
    );

    // Local / file-imported docs that already have this ETA uuid: refresh status only.
    if (existing && existing.origin !== 'ETA_SYNC') {
      await this.refreshLocalIssuedStatus(tenantId, existing.id, row);
      return 'updated';
    }

    // Already imported with line details — status-only refresh (resume-friendly).
    if (existing && existing.origin === 'ETA_SYNC' && existing._count.lines > 0) {
      await this.refreshLocalIssuedStatus(tenantId, existing.id, row);
      return 'skipped';
    }

    let details: Record<string, unknown>;
    try {
      await paceEtaSyncRequest();
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
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.update({
          where: { id: existing.id },
          data: {
            etaLongId: mapped.etaLongId,
            etaStatus: mapped.etaStatus,
            status: mapped.status,
            etaStatusUpdatedAt: new Date(),
            taxTotalsJson: mapped.taxTotalsJson,
            totalSalesAmount: mapped.totalSalesAmount,
            totalDiscountAmount: mapped.totalDiscountAmount,
            netAmount: mapped.netAmount,
            totalAmount: mapped.totalAmount,
            etaPayloadJson: mapped.etaPayloadJson,
            ...(mapped.signaturesJson
              ? { signaturesJson: mapped.signaturesJson }
              : {}),
          },
        }),
      );
      return 'updated';
    }

    // Match by internalId for docs created here before UUID was known.
    const byInternal = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({
        where: { tenantId, internalId: mapped.internalId },
        select: { id: true, origin: true },
      }),
    );
    if (byInternal) {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.update({
          where: { id: byInternal.id },
          data: {
            etaUuid: mapped.etaUuid,
            etaLongId: mapped.etaLongId,
            etaStatus: mapped.etaStatus,
            status: mapped.status,
            etaStatusUpdatedAt: new Date(),
            etaEnvironment,
          },
        }),
      );
      return 'updated';
    }

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

    let internalId = mapped.internalId;
    const clash = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({
        where: { tenantId, internalId },
        select: { id: true },
      }),
    );
    if (clash) {
      internalId = `ETA-${mapped.etaUuid.slice(0, 12)}`;
    }

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.document.create({
        data: {
          tenantId,
          kind: mapped.kind,
          status: mapped.status,
          origin: 'ETA_SYNC',
          branchId: branch.id,
          currencyCode: mapped.currencyCode,
          issueDateTime: mapped.issueDateTime,
          internalId,
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
            create: mapped.lines.map((l) => ({
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
            })),
          },
        },
      });
    });

    return 'new';
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
    const etaStatusRaw = String(
      row.status ?? row.Status ?? row.documentStatus ?? '',
    ).trim();
    const localStatus = ETA_STATUS_TO_LOCAL[etaStatusRaw.toLowerCase()];

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.update({
        where: { id: documentId },
        data: {
          ...(uuid ? { etaUuid: uuid } : {}),
          ...(longId ? { etaLongId: longId } : {}),
          ...(etaStatusRaw ? { etaStatus: etaStatusRaw } : {}),
          ...(localStatus ? { status: localStatus } : {}),
          etaStatusUpdatedAt: new Date(),
        },
      }),
    );
  }
}
