import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaDocumentRawClient } from '../eta/eta-document-raw.client';
import { EtaPrintoutClient } from '../eta/eta-printout.client';
import {
  EtaDocumentLifecycleClient,
  EtaDocumentLifecycleError,
} from '../eta/eta-document-lifecycle.client';
import { DocumentStatusEventsService } from '../submissions/document-status-events.service';
import {
  checkLateSubmission,
  ETA_LATE_SUBMISSION_WARN_DAYS_DEFAULT,
} from '@einvoice/eta-core';
@Injectable()
export class IssuedEtaService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eta: EtaService,
    private readonly statusEvents: DocumentStatusEventsService,
    private readonly audit: AuditService,
  ) {}

  private async clientsFor(tenantId: string) {
    const base = await this.eta.getApiBaseUrl(tenantId);
    return {
      raw: new EtaDocumentRawClient(base),
      printout: new EtaPrintoutClient(base),
      lifecycle: new EtaDocumentLifecycleClient(base),
    };
  }

  private async requireIssuedDoc(tenantId: string, id: string) {
    const doc = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({ where: { id, tenantId } }),
    );
    if (!doc) throw new NotFoundException('Document not found');
    if (!doc.etaUuid) {
      throw new BadRequestException(
        'Document has no ETA UUID yet — submit and wait for acceptance first',
      );
    }
    return doc;
  }

  /** GET Document (source JSON/XML + tax-authority metadata). */
  async getEtaSource(tenantId: string, actorUserId: string, id: string) {
    const doc = await this.requireIssuedDoc(tenantId, id);
    const { raw } = await this.clientsFor(tenantId);
    const result = await this.eta.withAccessToken(
      tenantId,
      { branchId: doc.branchId },
      (token) => raw.getRaw(token, doc.etaUuid!),
    );
    await this.audit.write({
      action: 'documents.eta_source.download',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { etaUuid: doc.etaUuid, contentType: result.contentType },
    });
    return {
      documentId: doc.id,
      internalId: doc.internalId,
      etaUuid: doc.etaUuid,
      contentType: result.contentType,
      body: result.json ?? result.bodyText,
      bodyText: result.bodyText,
    };
  }

  /** Official ETA PDF printout. */
  async getPrintout(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<{ pdf: Buffer; filename: string; etaUuid: string }> {
    const doc = await this.requireIssuedDoc(tenantId, id);
    const { printout } = await this.clientsFor(tenantId);
    const pdf = await this.eta.withAccessToken(
      tenantId,
      { branchId: doc.branchId },
      (token) => printout.getPdf(token, doc.etaUuid!),
    );
    await this.audit.write({
      action: 'documents.printout.download',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { etaUuid: doc.etaUuid },
    });
    return {
      pdf,
      filename: `eta-${doc.internalId || doc.etaUuid}.pdf`,
      etaUuid: doc.etaUuid!,
    };
  }

  /** Issuer cancel within ETA's window (ETA enforces; we surface refusals). */
  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    reason: string,
  ) {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new BadRequestException('Cancellation reason is required');
    }
    const doc = await this.requireIssuedDoc(tenantId, id);
    if (doc.status !== 'VALID' && doc.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Document ${doc.internalId} cannot be cancelled from status ${doc.status}`,
      );
    }
    const { lifecycle } = await this.clientsFor(tenantId);
    try {
      await this.eta.withAccessToken(
        tenantId,
        { branchId: doc.branchId },
        (token) => lifecycle.cancelDocument(token, doc.etaUuid!, trimmed),
      );
    } catch (err) {
      const message =
        err instanceof EtaDocumentLifecycleError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'ETA cancel failed';
      await this.audit.write({
        action: 'documents.cancel',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'document',
        resourceId: id,
        metadata: { etaUuid: doc.etaUuid, reason: trimmed, message },
      });
      throw new BadRequestException(message);
    }

    await this.statusEvents.applyEtaStatus(tenantId, id, 'Cancelled', {
      actorUserId,
      raw: { status: 'cancelled', reason: trimmed, source: 'issuer_cancel' },
    });
    await this.audit.write({
      action: 'documents.cancel',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { etaUuid: doc.etaUuid, reason: trimmed },
    });
    return { id, status: 'CANCELLED', etaUuid: doc.etaUuid };
  }

  /** Issuer declines a receiver's rejection. */
  async declineRejection(
    tenantId: string,
    actorUserId: string,
    id: string,
  ) {
    const doc = await this.requireIssuedDoc(tenantId, id);
    if (doc.status !== 'REJECTED') {
      throw new BadRequestException(
        `Document ${doc.internalId} is not REJECTED (status: ${doc.status})`,
      );
    }
    const { lifecycle } = await this.clientsFor(tenantId);
    try {
      await this.eta.withAccessToken(
        tenantId,
        { branchId: doc.branchId },
        (token) => lifecycle.declineRejection(token, doc.etaUuid!),
      );
    } catch (err) {
      const message =
        err instanceof EtaDocumentLifecycleError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'ETA decline rejection failed';
      await this.audit.write({
        action: 'documents.decline_rejection',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'document',
        resourceId: id,
        metadata: { etaUuid: doc.etaUuid, message },
      });
      throw new BadRequestException(message);
    }
    await this.audit.write({
      action: 'documents.decline_rejection',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { etaUuid: doc.etaUuid },
    });
    return { id, etaUuid: doc.etaUuid };
  }

  /**
   * Bulk cancel for selected VALID docs. Continues on per-doc failures;
   * returns a summary like batch submit.
   */
  async cancelSelected(
    tenantId: string,
    actorUserId: string,
    documentIds: string[],
    reason: string,
  ) {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new BadRequestException('Cancellation reason is required');
    }
    const results: Array<{
      documentId: string;
      internalId: string | null;
      outcome: 'cancelled' | 'skipped' | 'failed';
      reason?: string;
      status?: string | null;
    }> = [];

    for (const id of [...new Set(documentIds)]) {
      const doc = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.findFirst({ where: { id, tenantId } }),
      );
      if (!doc) {
        results.push({
          documentId: id,
          internalId: null,
          outcome: 'failed',
          reason: 'not_found',
        });
        continue;
      }
      if (!doc.etaUuid || (doc.status !== 'VALID' && doc.status !== 'SUBMITTED')) {
        results.push({
          documentId: id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: !doc.etaUuid ? 'no_eta_uuid' : `status_${doc.status.toLowerCase()}`,
          status: doc.status,
        });
        continue;
      }
      try {
        await this.cancel(tenantId, actorUserId, id, trimmed);
        results.push({
          documentId: id,
          internalId: doc.internalId,
          outcome: 'cancelled',
          status: 'CANCELLED',
        });
      } catch (err) {
        results.push({
          documentId: id,
          internalId: doc.internalId,
          outcome: 'failed',
          reason: err instanceof Error ? err.message.slice(0, 300) : 'cancel_failed',
          status: doc.status,
        });
      }
    }

    return {
      requested: results.length,
      cancelled: results.filter((r) => r.outcome === 'cancelled').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
    };
  }

  /** Advisory late flags for selected / listed docs (never mutates dates). */
  lateWarningsFor(
    docs: Array<{ id: string; internalId: string; issueDateTime: Date }>,
    warnDays = ETA_LATE_SUBMISSION_WARN_DAYS_DEFAULT,
  ) {
    return docs.map((d) => {
      const check = checkLateSubmission(d.issueDateTime, new Date(), warnDays);
      return {
        documentId: d.id,
        internalId: d.internalId,
        ...check,
      };
    });
  }
}
