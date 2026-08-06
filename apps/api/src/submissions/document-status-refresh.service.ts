import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaDocumentDetailsClient } from '../eta/eta-document-details.client';
import {
  EtaSubmissionStatusClient,
  extractEtaDocumentStatus,
} from '../eta/eta-submission-status.client';
import { DocumentStatusEventsService } from './document-status-events.service';
import { mapEtaStatusToLocal } from '../eta/eta-status-map';

export type StatusRefreshOutcome =
  | 'updated'
  | 'unchanged'
  | 'skipped'
  | 'failed';

export type StatusRefreshItemResult = {
  documentId: string;
  internalId: string;
  outcome: StatusRefreshOutcome;
  reason?: string;
  previousStatus: string | null;
  status: string | null;
  etaStatus: string | null;
  etaStatusUpdatedAt: string | null;
};

export type StatusRefreshBatchResult = {
  requested: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  results: StatusRefreshItemResult[];
};

/** Space ETA calls so a multi-select refresh doesn't trip rate limits. */
const INTER_QUERY_DELAY_MS = 150;

@Injectable()
export class DocumentStatusRefreshService {
  private readonly logger = new Logger(DocumentStatusRefreshService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eta: EtaService,
    private readonly statusEvents: DocumentStatusEventsService,
    private readonly audit: AuditService,
  ) {}

  private async clientsFor(tenantId: string) {
    const base = await this.eta.getApiBaseUrl(tenantId);
    return {
      details: new EtaDocumentDetailsClient(base),
      submissions: new EtaSubmissionStatusClient(base),
    };
  }

  async refreshOne(
    tenantId: string,
    actorUserId: string,
    documentId: string,
  ): Promise<StatusRefreshItemResult> {
    const batch = await this.refreshMany(tenantId, actorUserId, {
      documentIds: [documentId],
    });
    const item = batch.results[0];
    if (!item) throw new NotFoundException('Document not found');
    return item;
  }

  /**
   * Refresh ETA status for selected docs, or all pending SUBMITTED docs when
   * `pendingOnly` is set. Queries are sequential with a short delay; etaFetch
   * already backs off on 5xx.
   */
  async refreshMany(
    tenantId: string,
    actorUserId: string,
    opts: { documentIds?: string[]; pendingOnly?: boolean },
  ): Promise<StatusRefreshBatchResult> {
    const docs = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const select = {
        id: true,
        internalId: true,
        status: true,
        etaUuid: true,
        submissionUuid: true,
        branchId: true,
        etaStatus: true,
        etaStatusUpdatedAt: true,
      } as const;

      if (opts.pendingOnly) {
        return tx.document.findMany({
          where: {
            tenantId,
            status: 'SUBMITTED',
            etaUuid: { not: null },
          },
          orderBy: { updatedAt: 'asc' },
          select,
        });
      }
      const ids = opts.documentIds ?? [];
      if (!ids.length) return [];
      return tx.document.findMany({
        where: { tenantId, id: { in: ids } },
        select,
      });
    });

    // Preserve caller order when documentIds were provided.
    const ordered =
      opts.documentIds?.length && !opts.pendingOnly
        ? opts.documentIds
            .map((id) => docs.find((d) => d.id === id))
            .filter((d): d is (typeof docs)[number] => Boolean(d))
        : docs;

    const results: StatusRefreshItemResult[] = [];
    const tokenCache = new Map<string, string>();
    const clients = await this.clientsFor(tenantId);

    for (let i = 0; i < ordered.length; i++) {
      const doc = ordered[i]!;
      if (i > 0) await sleep(INTER_QUERY_DELAY_MS);

      if (!doc.etaUuid) {
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: 'no_eta_uuid',
          previousStatus: doc.status,
          status: doc.status,
          etaStatus: doc.etaStatus,
          etaStatusUpdatedAt: doc.etaStatusUpdatedAt?.toISOString() ?? null,
        });
        continue;
      }

      try {
        // Cached token (Redis + single-flight). Branch map avoids even a Redis
        // round-trip for every row; 401 clears the slot and refreshes once.
        const cacheKey = doc.branchId;
        let token = tokenCache.get(cacheKey);
        if (!token) {
          token = await this.eta.getAccessToken(tenantId, {
            branchId: doc.branchId,
          });
          tokenCache.set(cacheKey, token);
        }

        let etaStatus: string | null;
        try {
          etaStatus = await this.queryDocumentStatus(
            clients.details,
            token,
            doc.etaUuid,
          );
          if (!etaStatus && doc.submissionUuid) {
            etaStatus = await this.querySubmissionDocumentStatus(
              clients.submissions,
              token,
              doc.submissionUuid,
              doc.etaUuid,
              doc.internalId,
            );
          }
        } catch (err) {
          const status =
            err && typeof err === 'object'
              ? ((err as { httpStatus?: number; status?: number }).httpStatus ??
                (err as { status?: number }).status)
              : undefined;
          if (status !== 401) throw err;
          token = await this.eta.getAccessToken(tenantId, {
            branchId: doc.branchId,
            forceRefresh: true,
          });
          tokenCache.set(cacheKey, token);
          etaStatus = await this.queryDocumentStatus(
            clients.details,
            token,
            doc.etaUuid,
          );
          if (!etaStatus && doc.submissionUuid) {
            etaStatus = await this.querySubmissionDocumentStatus(
              clients.submissions,
              token,
              doc.submissionUuid,
              doc.etaUuid,
              doc.internalId,
            );
          }
        }

        if (!etaStatus) {
          results.push({
            documentId: doc.id,
            internalId: doc.internalId,
            outcome: 'failed',
            reason: 'eta_status_missing',
            previousStatus: doc.status,
            status: doc.status,
            etaStatus: doc.etaStatus,
            etaStatusUpdatedAt: doc.etaStatusUpdatedAt?.toISOString() ?? null,
          });
          continue;
        }

        const mapped = mapEtaStatusToLocal(etaStatus);
        if (!mapped) {
          results.push({
            documentId: doc.id,
            internalId: doc.internalId,
            outcome: 'failed',
            reason: `unmapped_eta_status:${etaStatus}`,
            previousStatus: doc.status,
            status: doc.status,
            etaStatus,
            etaStatusUpdatedAt: new Date().toISOString(),
          });
          continue;
        }

        const previousStatus = doc.status;
        const applied = await this.statusEvents.applyEtaStatus(
          tenantId,
          doc.id,
          etaStatus,
          { actorUserId, raw: { status: etaStatus, source: 'manual_refresh' } },
        );

        const refreshed = await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.document.findFirst({
            where: { id: doc.id, tenantId },
            select: {
              status: true,
              etaStatus: true,
              etaStatusUpdatedAt: true,
            },
          }),
        );

        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome:
            applied && applied !== previousStatus
              ? 'updated'
              : 'unchanged',
          previousStatus,
          status: refreshed?.status ?? applied ?? previousStatus,
          etaStatus: refreshed?.etaStatus ?? etaStatus,
          etaStatusUpdatedAt:
            refreshed?.etaStatusUpdatedAt?.toISOString() ??
            new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'refresh_failed';
        this.logger.warn(
          `Status refresh failed for ${doc.internalId}: ${message}`,
        );
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'failed',
          reason: message.slice(0, 300),
          previousStatus: doc.status,
          status: doc.status,
          etaStatus: doc.etaStatus,
          etaStatusUpdatedAt: doc.etaStatusUpdatedAt?.toISOString() ?? null,
        });
      }
    }

    const summary = {
      requested: results.length,
      updated: results.filter((r) => r.outcome === 'updated').length,
      unchanged: results.filter((r) => r.outcome === 'unchanged').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
    };

    await this.audit.write({
      action: 'documents.status_refresh',
      outcome: summary.failed && !summary.updated ? 'failure' : 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      metadata: {
        pendingOnly: Boolean(opts.pendingOnly),
        requested: summary.requested,
        updated: summary.updated,
        unchanged: summary.unchanged,
        skipped: summary.skipped,
        failed: summary.failed,
      },
    });

    return summary;
  }

  private async queryDocumentStatus(
    details: EtaDocumentDetailsClient,
    accessToken: string,
    etaUuid: string,
  ): Promise<string | null> {
    const body = await details.getDetails(accessToken, etaUuid);
    return extractEtaDocumentStatus(body);
  }

  private async querySubmissionDocumentStatus(
    submissions: EtaSubmissionStatusClient,
    accessToken: string,
    submissionUuid: string,
    etaUuid: string,
    internalId: string,
  ): Promise<string | null> {
    const body = await submissions.getSubmission(accessToken, submissionUuid);
    const rows = Array.isArray(body.documents)
      ? (body.documents as Record<string, unknown>[])
      : Array.isArray(body.acceptedDocuments)
        ? (body.acceptedDocuments as Record<string, unknown>[])
        : [];
    const match = rows.find((r) => {
      const uuid = String(r.uuid ?? r.UUID ?? r.documentUUID ?? '');
      const internal = String(r.internalId ?? r.InternalId ?? '');
      return uuid === etaUuid || internal === internalId;
    });
    return extractEtaDocumentStatus(match ?? null);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
