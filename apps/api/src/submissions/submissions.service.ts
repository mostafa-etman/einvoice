import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import type { DocumentStatus, Prisma, Submission } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaSubmitClient, EtaSubmitError } from '../eta/eta-submit.client';
import { assembleSubmitDocuments } from './batch-assembler';
import { verifyPayloadInternalIds, verifyEtaPayloadFormats } from './submission-integrity';
import {
  apply202ResultMap,
  type Eta202Body,
} from './submission-202-result-map';
import { buildSignedEtaPayload } from './signed-payload';
import { etaDocumentDigest, verifySignedDigest } from './cades-digest';
import {
  evaluateCooldown,
  isCooldownClearable,
  isInFlightHeld,
  IN_FLIGHT_STALE_MS,
  type CooldownState,
} from './submit-cooldown';
import { MAX_DUPLICATE_RETRIES } from './duplicate-submission';
import { checkLateSubmission, parseEtaDocument, type JsonObject } from '@einvoice/eta-core';
import { UsageEmitService } from '../analytics/usage-emit.service';
import { QuotaService } from '../billing/quota.service';

export type SubmitAttemptLogEntry = {
  at: string;
  outcome:
    | 'posted'
    | 'accepted'
    | 'refused'
    | 'duplicate_cooldown'
    | 'error'
    | 'blocked'
    | 'empty_202';
  httpStatus?: number;
  code?: string;
  message?: string;
  triggerSource?: string;
  retryAfterSeconds?: number;
  /** Raw ETA response body (truncated) for diagnostics. */
  rawBody?: string;
};

export type SubmissionDetail = {
  id: string;
  state: string;
  etaSubmissionUuid: string | null;
  documentCount: number;
  acceptedCount: number;
  refusedCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  triggerSource: string;
  nextAttemptAt: string | null;
  /** True when state is WAITING_COOLDOWN (422 duplicate) — not a result. */
  isTransientCooldown: boolean;
  etaRawResponse: unknown;
  documents: Array<{
    documentId: string;
    internalId: string;
    attemptOutcome: string;
    etaUuid: string | null;
    etaLongId: string | null;
    intakeError: unknown;
    documentStatus: string;
  }>;
};

export type BatchSubmitItemResult = {
  documentId: string;
  internalId: string | null;
  outcome: 'sent' | 'skipped' | 'failed';
  reason?: string;
  attemptOutcome?: string;
  etaUuid?: string | null;
  documentStatus: string | null;
  intakeError?: unknown;
};

export type BatchSubmitResult = {
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
  submissionId: string | null;
  submission: SubmissionDetail | null;
  /** Advisory only — ETA still decides; signed issue dates are never mutated. */
  lateWarnings: Array<{
    documentId: string;
    internalId: string;
    issueDateTime: string;
    ageDays: number;
    warnDays: number;
    isLate: boolean;
  }>;
  results: BatchSubmitItemResult[];
};

@Injectable()
export class SubmissionsService implements OnModuleDestroy {
  private readonly logger = new Logger(SubmissionsService.name);
  /** Exactly one delayed retry timer per document. */
  private readonly delayedRetries = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eta: EtaService,
    private readonly audit: AuditService,
    private readonly usageEmit: UsageEmitService,
    private readonly quota: QuotaService,
  ) {}

  onModuleDestroy() {
    for (const [docId, timer] of this.delayedRetries) {
      clearTimeout(timer);
      this.delayedRetries.delete(docId);
    }
  }

  /**
   * FR-040: after agent signature intake, auto-submit. Failures must not
   * undo SIGNED — they surface on the document via needsAttention.
   */
  async enqueueAfterAgentSign(
    tenantId: string,
    documentId: string,
    documentVersion: number,
  ): Promise<SubmissionDetail | null> {
    const key = `agent-sign:${documentId}:v${documentVersion}`;
    try {
      return await this.submitDocuments(tenantId, null, [documentId], {
        idempotencyKey: key,
        triggerSource: 'agent_signed',
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.warn(
          `Auto-submit skipped for ${documentId}: ${(err.getResponse() as { message?: string })?.message ?? err.message}`,
        );
        return null;
      }
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof EtaSubmitError
          ? err.code
          : err instanceof BadRequestException
            ? 'bad_request'
            : 'submit_enqueue_failed';
      this.logger.error(
        `Auto-submit after sign failed for ${documentId}: ${message}`,
      );
      await this.markDocumentVisibleFailure(tenantId, documentId, code, message);
      return null;
    }
  }

  async submitDocuments(
    tenantId: string,
    actorUserId: string | null,
    documentIds: string[],
    opts: {
      idempotencyKey: string;
      triggerSource: string;
      /** Internal: fire the single scheduled delayed retry (bypasses cooldown gate). */
      isScheduledRetry?: boolean;
    },
  ): Promise<SubmissionDetail> {
    if (!documentIds.length) {
      throw new BadRequestException('At least one documentId is required');
    }
    if (!opts.idempotencyKey || opts.idempotencyKey.length < 8) {
      throw new BadRequestException('Idempotency-Key must be at least 8 characters');
    }

    await this.quota.checkTenantWritable(tenantId);
    // Each document in the batch that would newly count as issued needs headroom.
    // Assert once per submission: if already at limit, refuse before ETA post.
    await this.quota.assertWithinLimits(tenantId, 'documents');

    // Document-level gates (cooldown / in-flight) — stop the duplicate loop.
    if (!opts.isScheduledRetry) {
      await this.assertDocumentsSubmittable(tenantId, documentIds, opts.triggerSource);
    }

    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.submission.findUnique({
        where: {
          tenantId_batchIdempotencyKey: {
            tenantId,
            batchIdempotencyKey: opts.idempotencyKey,
          },
        },
      }),
    );

    if (existing) {
      // CRITICAL: never re-POST on idempotent replay of NEEDS_ATTENTION —
      // that was resetting ETA's 10-minute window on every click/tick.
      if (existing.state === 'ASSEMBLING') {
        await this.processSubmission(tenantId, existing.id, actorUserId, {
          triggerSource: opts.triggerSource,
          isScheduledRetry: opts.isScheduledRetry,
        });
      } else if (existing.state === 'WAITING_COOLDOWN') {
        // The gate above already proved no cooldown is active for these
        // documents, so a WAITING_COOLDOWN batch is stale: POST it again
        // instead of replaying it forever (that made cooldowns look sticky).
        await this.processSubmission(tenantId, existing.id, actorUserId, {
          triggerSource: opts.triggerSource,
          isScheduledRetry: opts.isScheduledRetry,
        });
      } else {
        this.logger.log(
          `Idempotent replay for submission ${existing.id} state=${existing.state} — no ETA POST`,
        );
        await this.audit.write({
          action: 'submissions.idempotent_replay',
          outcome: 'success',
          actorUserId,
          tenantId,
          resourceType: 'submission',
          resourceId: existing.id,
          metadata: {
            batchIdempotencyKey: opts.idempotencyKey,
            state: existing.state,
            triggerSource: opts.triggerSource,
          },
        });
      }
      return this.getDetail(tenantId, existing.id);
    }

    const submission = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const docs = await tx.document.findMany({
        where: { tenantId, id: { in: documentIds } },
      });
      if (docs.length !== documentIds.length) {
        throw new NotFoundException('One or more documents were not found');
      }

      for (const doc of docs) {
        if (doc.origin === 'ETA_SYNC') {
          throw new BadRequestException(
            `Document ${doc.internalId} was imported from ETA and cannot be re-submitted`,
          );
        }
        if (doc.status !== 'SIGNED') {
          throw new BadRequestException(
            `Document ${doc.internalId} must be SIGNED to submit (status: ${doc.status})`,
          );
        }
        if (!doc.signaturesJson) {
          throw new BadRequestException(
            `Document ${doc.internalId} has no signatures attached`,
          );
        }
        const lock = await tx.documentFilingLock.findUnique({
          where: {
            tenantId_documentId_documentVersion: {
              tenantId,
              documentId: doc.id,
              documentVersion: doc.version,
            },
          },
        });
        if (lock) {
          throw new BadRequestException(
            `Document ${doc.internalId} is already filed (filing lock present)`,
          );
        }
      }

      const etaEnvironment = await this.eta.getActiveEnvironment(tenantId);
      const created = await tx.submission.create({
        data: {
          tenantId,
          batchIdempotencyKey: opts.idempotencyKey,
          state: 'ASSEMBLING',
          etaEnvironment,
          documentCount: docs.length,
          createdByUserId: actorUserId,
          triggerSource: opts.triggerSource,
          documents: {
            create: docs.map((d) => ({
              tenantId,
              documentId: d.id,
              documentVersion: d.version,
              internalId: d.internalId,
              attemptOutcome: 'PENDING',
            })),
          },
        },
      });

      return created;
    });

    await this.audit.write({
      action: 'submissions.created',
      outcome: 'success',
      actorUserId: actorUserId ?? undefined,
      tenantId,
      resourceType: 'submission',
      resourceId: submission.id,
      metadata: {
        documentIds,
        triggerSource: opts.triggerSource,
      },
    });

    await this.processSubmission(tenantId, submission.id, actorUserId, {
      triggerSource: opts.triggerSource,
      isScheduledRetry: opts.isScheduledRetry,
    });
    return this.getDetail(tenantId, submission.id);
  }

  async submitSingleDocument(
    tenantId: string,
    actorUserId: string,
    documentId: string,
    idempotencyKey: string,
  ): Promise<SubmissionDetail> {
    // Stable key per document so repeated clicks replay without a new POST.
    const key =
      idempotencyKey && !idempotencyKey.startsWith('manual:')
        ? idempotencyKey
        : `manual-stable:${documentId}`;
    return this.submitDocuments(tenantId, actorUserId, [documentId], {
      idempotencyKey: key,
      triggerSource: 'user',
    });
  }

  /**
   * List multi-select send: partition selected IDs into eligible SIGNED docs
   * vs skipped (wrong status / in-flight / cooldown / no signature), then
   * reuse submitDocuments for the eligible set.
   */
  async submitSelected(
    tenantId: string,
    actorUserId: string,
    documentIds: string[],
    idempotencyKey: string,
  ): Promise<BatchSubmitResult> {
    const uniqueIds = [...new Set(documentIds.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('At least one documentId is required');
    }
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new BadRequestException('Idempotency-Key must be at least 8 characters');
    }

    const docs = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: { tenantId, id: { in: uniqueIds } },
        include: {
          filingLocks: {
            where: { tenantId },
            select: { documentVersion: true },
          },
        },
      }),
    );
    const byId = new Map(docs.map((d) => [d.id, d]));

    const results: BatchSubmitItemResult[] = [];
    const eligibleIds: string[] = [];

    for (const id of uniqueIds) {
      const doc = byId.get(id);
      if (!doc) {
        results.push({
          documentId: id,
          internalId: null,
          outcome: 'failed',
          reason: 'not_found',
          documentStatus: null,
        });
        continue;
      }

      if (doc.status !== 'SIGNED') {
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: `status_${doc.status.toLowerCase()}`,
          documentStatus: doc.status,
        });
        continue;
      }
      if (!doc.signaturesJson) {
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: 'no_signatures',
          documentStatus: doc.status,
        });
        continue;
      }
      if (
        doc.filingLocks.some((l) => l.documentVersion === doc.version)
      ) {
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: 'filing_lock',
          documentStatus: doc.status,
        });
        continue;
      }
      if (isInFlightHeld(doc.submitInFlight, doc.submitInFlightSince)) {
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: 'submit_in_flight',
          documentStatus: doc.status,
        });
        continue;
      }
      const payloadHash = this.payloadHashOf(doc);
      const cooldown = evaluateCooldown(this.cooldownStateOf(doc), payloadHash);
      if (cooldown.blocked) {
        results.push({
          documentId: doc.id,
          internalId: doc.internalId,
          outcome: 'skipped',
          reason: 'duplicate_cooldown',
          documentStatus: doc.status,
        });
        continue;
      }

      eligibleIds.push(doc.id);
    }

    let submission: SubmissionDetail | null = null;
    const lateWarnings = eligibleIds.map((id) => {
      const doc = byId.get(id)!;
      const check = checkLateSubmission(doc.issueDateTime);
      return {
        documentId: doc.id,
        internalId: doc.internalId,
        ...check,
      };
    });

    if (eligibleIds.length) {
      try {
        submission = await this.submitDocuments(
          tenantId,
          actorUserId,
          eligibleIds,
          {
            idempotencyKey,
            triggerSource: 'user_batch',
          },
        );
        for (const row of submission.documents) {
          results.push({
            documentId: row.documentId,
            internalId: row.internalId,
            outcome:
              row.attemptOutcome === 'ACCEPTED'
                ? 'sent'
                : row.attemptOutcome === 'REFUSED_AT_INTAKE'
                  ? 'failed'
                  : row.attemptOutcome === 'PENDING'
                    ? 'sent'
                    : 'failed',
            reason: row.attemptOutcome,
            attemptOutcome: row.attemptOutcome,
            etaUuid: row.etaUuid,
            documentStatus: row.documentStatus,
            intakeError: row.intakeError,
          });
        }
      } catch (err) {
        const message =
          err instanceof ConflictException || err instanceof BadRequestException
            ? (() => {
                const res = err.getResponse();
                if (typeof res === 'string') return res;
                if (res && typeof res === 'object') {
                  const o = res as { message?: string | string[]; code?: string };
                  const msg = Array.isArray(o.message)
                    ? o.message.join('; ')
                    : o.message;
                  return o.code ? `${o.code}: ${msg ?? ''}` : (msg ?? err.message);
                }
                return err.message;
              })()
            : err instanceof Error
              ? err.message
              : 'submit_failed';
        for (const id of eligibleIds) {
          const doc = byId.get(id)!;
          results.push({
            documentId: id,
            internalId: doc.internalId,
            outcome: 'failed',
            reason: message.slice(0, 300),
            documentStatus: doc.status,
          });
        }
      }
    }

    // Keep results in the caller's selection order.
    const byDoc = new Map(results.map((r) => [r.documentId, r]));
    const ordered = uniqueIds
      .map((id) => byDoc.get(id))
      .filter((r): r is BatchSubmitItemResult => Boolean(r));

    return {
      requested: uniqueIds.length,
      sent: ordered.filter((r) => r.outcome === 'sent').length,
      skipped: ordered.filter((r) => r.outcome === 'skipped').length,
      failed: ordered.filter((r) => r.outcome === 'failed').length,
      submissionId: submission?.id ?? null,
      submission,
      lateWarnings: lateWarnings.filter((w) => w.isLate),
      results: ordered,
    };
  }

  /**
   * Cancel pending delayed retries and clear cooldown so ETA's window can
   * fully elapse with ZERO further POSTs.
   */
  async resetSubmitCooldown(
    tenantId: string,
    documentId: string,
    actorUserId: string,
  ) {
    this.cancelDelayedRetry(documentId);

    const doc = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findFirst({
        where: { id: documentId, tenantId },
      });
      if (!existing) throw new NotFoundException('Document not found');

      const pendingId = existing.submitPendingRetrySubmissionId;
      if (pendingId) {
        await tx.submission.updateMany({
          where: {
            id: pendingId,
            tenantId,
            state: { in: ['WAITING_COOLDOWN', 'NEEDS_ATTENTION', 'ASSEMBLING'] },
          },
          data: {
            nextAttemptAt: null,
            state: 'ASSEMBLING',
            lastErrorCode: 'COOLDOWN_RESET',
            lastErrorMessage:
              'Cooldown cleared by user; pending delayed retry cancelled — not a result',
          },
        });
      }

      return tx.document.update({
        where: { id: documentId },
        data: {
          submitCooldownUntil: null,
          submitCooldownPayloadHash: null,
          submitInFlight: false,
          submitInFlightSince: null,
          submitPendingRetrySubmissionId: null,
          submitDuplicateRetryCount: 0,
          // Restore SIGNED if CAdES present (status may have been overwritten).
          status: existing.signaturesJson ? 'SIGNED' : existing.status,
          needsAttention: false,
          needsAttentionReason: null,
        },
      });
    });

    await this.appendAttemptLog(tenantId, documentId, {
      at: new Date().toISOString(),
      outcome: 'blocked',
      code: 'COOLDOWN_RESET',
      message: 'User cleared cooldown and cancelled pending retries',
      triggerSource: 'user',
    });

    await this.audit.write({
      action: 'submissions.cooldown_reset',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: documentId,
    });

    return {
      documentId: doc.id,
      submitCooldownUntil: null,
      submitInFlight: false,
      submitAttemptCount: doc.submitAttemptCount,
      submitAttemptLog: doc.submitAttemptLog,
      message:
        'Cooldown cleared. Do not submit again until ETA’s 10-minute window fully elapses.',
    };
  }

  async getDetail(tenantId: string, submissionId: string): Promise<SubmissionDetail> {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.submission.findFirst({
        where: { id: submissionId, tenantId },
        include: {
          documents: {
            include: {
              document: { select: { status: true } },
            },
          },
        },
      }),
    );
    if (!row) throw new NotFoundException('Submission not found');
    return this.toDetail(row);
  }

  /**
   * Assemble → integrity → ETA POST → apply 202 map.
   */
  async processSubmission(
    tenantId: string,
    submissionId: string,
    actorUserId?: string | null,
    opts?: { triggerSource?: string; isScheduledRetry?: boolean },
  ): Promise<void> {
    const loaded = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: submissionId, tenantId },
        include: { documents: true },
      });
      if (!submission) throw new NotFoundException('Submission not found');

      const docs = await tx.document.findMany({
        where: {
          tenantId,
          id: { in: submission.documents.map((d) => d.documentId) },
        },
      });
      return { submission, docs };
    });

    const { submission, docs } = loaded;
    const docsById = new Map(docs.map((d) => [d.id, d]));
    const triggerSource = opts?.triggerSource ?? submission.triggerSource;

    // Acquire in-flight locks (one POST at a time per document). Release only
    // what we acquired, so a partial batch never strands another document.
    const acquiredDocIds: string[] = [];
    try {
      for (const doc of docs) {
        const acquired = await this.tryAcquireInFlight(tenantId, doc.id);
        if (!acquired) {
          throw new ConflictException({
            code: 'SUBMIT_IN_FLIGHT',
            message: `Document ${doc.internalId} already has a submit in flight`,
          });
        }
        acquiredDocIds.push(doc.id);
      }

      if (!opts?.isScheduledRetry) {
        for (const doc of docs) {
          const decision = evaluateCooldown(
            this.cooldownStateOf(doc),
            this.payloadHashOf(doc),
          );
          if (decision.blocked) {
            await this.appendAttemptLog(tenantId, doc.id, {
              at: new Date().toISOString(),
              outcome: 'blocked',
              code: 'ETA_DUPLICATE_COOLDOWN',
              message: `Blocked POST; cooldown active for ${decision.remainingSeconds}s`,
              triggerSource,
              retryAfterSeconds: decision.remainingSeconds,
            });
            throw new ConflictException({
              code: 'ETA_DUPLICATE_COOLDOWN',
              message: `ETA duplicate cooldown active. Retry after ${decision.remainingSeconds}s`,
              retryAfterSeconds: decision.remainingSeconds,
              submitCooldownUntil: decision.until.toISOString(),
            });
          }
        }
      }

      const stored = submission.documents.map((sd) => {
        const doc = docsById.get(sd.documentId);
        if (!doc) {
          throw new BadRequestException(`Missing document ${sd.documentId}`);
        }
        if (!doc.etaPayloadText) {
          throw new BadRequestException(
            `Document ${doc.internalId} has no exact payload bytes; save and re-sign it before submitting`,
          );
        }
        // Sign-and-send the SAME bytes: parse the stored text (order-preserving)
        // instead of the jsonb copy, which reorders keys and breaks the digest.
        const etaPayloadJson = buildSignedEtaPayload(
          parseEtaDocument(doc.etaPayloadText) as Record<string, unknown>,
          doc.signaturesJson,
        );
        return {
          id: doc.id,
          internalId: doc.internalId,
          etaPayloadJson,
        };
      });

      const assembled = assembleSubmitDocuments(stored);
      const integrity = verifyPayloadInternalIds(
        stored.map((d) => ({ id: d.id, internalId: d.internalId })),
        assembled.payloadsByDocumentId,
      );

      if (!integrity.ok) {
        await this.failSubmission(
          tenantId,
          submission,
          integrity.code,
          integrity.reason,
          actorUserId,
        );
        return;
      }

      const formatCheck = verifyEtaPayloadFormats(integrity.documents);
      if (!formatCheck.ok) {
        await this.failSubmission(
          tenantId,
          submission,
          formatCheck.code,
          formatCheck.reason,
          actorUserId,
        );
        return;
      }

      // Never POST a document whose signature does not cover these exact bytes.
      for (const outbound of integrity.documents) {
        const digestCheck = verifySignedDigest(outbound as JsonObject);
        if (!digestCheck.ok) {
          await this.failSubmission(
            tenantId,
            submission,
            'SIGNED_DIGEST_MISMATCH',
            `${String(outbound.internalID ?? '?')}: ${digestCheck.reason}`,
            actorUserId,
          );
          return;
        }
        this.logger.log(
          `pre-submit digest ok internalId=${String(outbound.internalID ?? '?')} digest=${digestCheck.digestHex} canonicalLength=${digestCheck.canonicalLength}`,
        );
      }

      // Log the POST attempt BEFORE calling ETA so we can prove how many fired.
      for (const doc of docs) {
        await this.appendAttemptLog(tenantId, doc.id, {
          at: new Date().toISOString(),
          outcome: 'posted',
          code: 'ETA_POST',
          message: `POST documentsubmissions (submission=${submission.id})`,
          triggerSource,
        });
        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.document.update({
            where: { id: doc.id },
            data: { submitAttemptCount: { increment: 1 } },
          }),
        );
        this.logger.log(
          `ETA submit attempt document=${doc.id} internalId=${doc.internalId} submission=${submission.id} trigger=${triggerSource} at=${new Date().toISOString()}`,
        );
      }

      let etaBody: Eta202Body;
      try {
        const branchId = docs[0]?.branchId;
        const apiBaseUrl = await this.eta.getApiBaseUrl(tenantId);
        const etaSubmit = new EtaSubmitClient(apiBaseUrl);
        // ONE cached token for the whole batch — never /connect/token per invoice.
        // On 401 (hour window ended mid-batch) refresh once and retry.
        etaBody = await this.eta.withAccessToken(
          tenantId,
          { branchId },
          (token) =>
            etaSubmit.postDocumentSubmissions(
              token,
              integrity.documents as Record<string, unknown>[],
            ),
        );
      } catch (err) {
        if (err instanceof EtaSubmitError && err.isDuplicate) {
          await this.handleDuplicateSubmission(
            tenantId,
            submission,
            docs.map((d) => d.id),
            err,
            actorUserId,
            triggerSource,
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof EtaSubmitError ? err.code : 'eta_submit_failed';
        const detail =
          err instanceof EtaSubmitError && err.bodyText
            ? `${message} | body=${err.bodyText.slice(0, 800)}`
            : message;
        for (const doc of docs) {
          await this.appendAttemptLog(tenantId, doc.id, {
            at: new Date().toISOString(),
            outcome: 'error',
            httpStatus: err instanceof EtaSubmitError ? err.httpStatus : undefined,
            code,
            message: detail.slice(0, 500),
            triggerSource,
          });
        }
        await this.failSubmission(tenantId, submission, code, detail, actorUserId);
        return;
      }

      await this.applyAccepted202(
        tenantId,
        submission,
        docs,
        docsById,
        etaBody,
        actorUserId,
        triggerSource,
      );
    } finally {
      for (const docId of acquiredDocIds) {
        await this.releaseInFlight(tenantId, docId);
      }
    }
  }

  private async handleDuplicateSubmission(
    tenantId: string,
    submission: Submission,
    documentIds: string[],
    err: EtaSubmitError,
    actorUserId: string | null | undefined,
    triggerSource: string,
  ) {
    const waitSec = err.retryAfterSeconds ?? 600;
    const cooldownUntil = new Date(Date.now() + waitSec * 1000);
    const rawBody = (err.bodyText ?? err.message).slice(0, 4000);

    // Parse JSON body when possible for storage; keep string fallback.
    let rawJson: Prisma.InputJsonValue = { httpStatus: 422, body: rawBody };
    try {
      rawJson = {
        httpStatus: 422,
        body: JSON.parse(err.bodyText ?? ''),
      } as Prisma.InputJsonValue;
    } catch {
      /* keep string wrapper */
    }

    for (const documentId of documentIds) {
      const doc = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.findFirst({ where: { id: documentId, tenantId } }),
      );
      if (!doc) continue;

      const nextRetryCount = (doc.submitDuplicateRetryCount ?? 0) + 1;
      const scheduleRetry = nextRetryCount <= MAX_DUPLICATE_RETRIES;

      // Case A: transient cooldown — NEVER needsAttention / NEVER result-mapping.
      // Scope it to the exact payload ETA called a duplicate so it can never
      // block another document, or this one after its bytes change.
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.update({
          where: { id: documentId },
          data: {
            submitCooldownUntil: cooldownUntil,
            submitCooldownPayloadHash: this.payloadHashOf(doc),
            submitDuplicateRetryCount: nextRetryCount,
            submitPendingRetrySubmissionId: scheduleRetry ? submission.id : null,
            needsAttention: false,
            needsAttentionReason: null,
          },
        }),
      );

      await this.appendAttemptLog(tenantId, documentId, {
        at: new Date().toISOString(),
        outcome: 'duplicate_cooldown',
        httpStatus: 422,
        code: 'ETA_DUPLICATE_SUBMISSION',
        message: `Transient cooldown ${waitSec}s — not a submission result`,
        triggerSource,
        retryAfterSeconds: waitSec,
        rawBody: rawBody.slice(0, 1500),
      });

      if (scheduleRetry) {
        this.scheduleExactlyOneDelayedRetry(
          tenantId,
          documentId,
          submission.id,
          waitSec,
        );
      } else {
        this.cancelDelayedRetry(documentId);
      }
    }

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.submission.update({
        where: { id: submission.id },
        data: {
          state: 'WAITING_COOLDOWN',
          // Keep counts at 0 — this is not an accepted/refused outcome.
          acceptedCount: 0,
          refusedCount: 0,
          lastErrorCode: 'ETA_DUPLICATE_COOLDOWN',
          lastErrorMessage:
            `Transient ETA duplicate window — retry at ${cooldownUntil.toISOString()} (${waitSec}s)`.slice(
              0,
              1000,
            ),
          nextAttemptAt: cooldownUntil,
          etaRawResponseJson: rawJson,
        },
      }),
    );

    await this.audit.write({
      action: 'submissions.duplicate_cooldown',
      outcome: 'success',
      actorUserId: actorUserId ?? undefined,
      tenantId,
      resourceType: 'submission',
      resourceId: submission.id,
      metadata: {
        retryAfterSeconds: waitSec,
        cooldownUntil: cooldownUntil.toISOString(),
        transient: true,
      },
    });

    this.logger.warn(
      `ETA DuplicateSubmission (transient) submission=${submission.id}; WAITING_COOLDOWN; one retry in ${waitSec}s`,
    );
  }

  private scheduleExactlyOneDelayedRetry(
    tenantId: string,
    documentId: string,
    submissionId: string,
    waitSec: number,
  ) {
    this.cancelDelayedRetry(documentId);
    // Add a small buffer so we don't fire early against ETA clock skew.
    const delayMs = (waitSec + 2) * 1000;
    this.logger.log(
      `Scheduling exactly ONE delayed ETA retry document=${documentId} submission=${submissionId} in ${waitSec}+2s`,
    );
    const timer = setTimeout(() => {
      this.delayedRetries.delete(documentId);
      void this.runScheduledRetry(tenantId, documentId, submissionId);
    }, delayMs);
    // Don't keep the event loop alive solely for this timer in tests.
    if (typeof timer.unref === 'function') timer.unref();
    this.delayedRetries.set(documentId, timer);
  }

  private cancelDelayedRetry(documentId: string) {
    const existing = this.delayedRetries.get(documentId);
    if (existing) {
      clearTimeout(existing);
      this.delayedRetries.delete(documentId);
      this.logger.log(`Cancelled delayed retry timer for document=${documentId}`);
    }
  }

  private async runScheduledRetry(
    tenantId: string,
    documentId: string,
    submissionId: string,
  ) {
    this.logger.log(
      `Firing scheduled ETA retry document=${documentId} submission=${submissionId} at=${new Date().toISOString()}`,
    );
    try {
      // Clear cooldown gate just before the single allowed retry.
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.update({
          where: { id: documentId },
          data: {
            submitCooldownUntil: null,
            submitCooldownPayloadHash: null,
            submitPendingRetrySubmissionId: null,
          },
        }),
      );
      await this.processSubmission(tenantId, submissionId, null, {
        triggerSource: 'delayed_retry',
        isScheduledRetry: true,
      });
    } catch (err) {
      this.logger.error(
        `Scheduled retry failed document=${documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async assertDocumentsSubmittable(
    tenantId: string,
    documentIds: string[],
    triggerSource: string,
  ) {
    const docs = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findMany({ where: { tenantId, id: { in: documentIds } } }),
    );
    for (const doc of docs) {
      if (isInFlightHeld(doc.submitInFlight, doc.submitInFlightSince)) {
        await this.appendAttemptLog(tenantId, doc.id, {
          at: new Date().toISOString(),
          outcome: 'blocked',
          code: 'SUBMIT_IN_FLIGHT',
          message: 'Blocked: submit already in flight',
          triggerSource,
        });
        throw new ConflictException({
          code: 'SUBMIT_IN_FLIGHT',
          message: `Document ${doc.internalId} already has a submit in flight`,
        });
      }

      const payloadHash = this.payloadHashOf(doc);
      const state = this.cooldownStateOf(doc);
      const decision = evaluateCooldown(state, payloadHash);

      if (!decision.blocked) {
        // Auto-expire: drop cooldown state that no longer applies so it can
        // never linger and leak onto later submissions.
        if (isCooldownClearable(state, payloadHash)) {
          await this.clearCooldown(tenantId, doc.id);
          this.logger.log(
            `Cleared stale cooldown document=${doc.id} internalId=${doc.internalId} reason=${decision.reason}`,
          );
        }
        continue;
      }

      await this.appendAttemptLog(tenantId, doc.id, {
        at: new Date().toISOString(),
        outcome: 'blocked',
        code: 'ETA_DUPLICATE_COOLDOWN',
        message: `Blocked: cooldown active (${decision.remainingSeconds}s remaining)`,
        triggerSource,
        retryAfterSeconds: decision.remainingSeconds,
      });
      throw new ConflictException({
        code: 'ETA_DUPLICATE_COOLDOWN',
        message: `ETA duplicate cooldown active for this document. Wait ${decision.remainingSeconds}s — other documents can be submitted normally.`,
        retryAfterSeconds: decision.remainingSeconds,
        submitCooldownUntil: decision.until.toISOString(),
        submitAttemptLog: doc.submitAttemptLog,
      });
    }
  }

  /** Canonical digest identifying the payload ETA sees (null when unsigned/unsaved). */
  private payloadHashOf(doc: { etaPayloadText: string | null }): string | null {
    if (!doc.etaPayloadText) return null;
    try {
      return etaDocumentDigest(
        parseEtaDocument(doc.etaPayloadText) as JsonObject,
      ).digestHex;
    } catch {
      return null;
    }
  }

  private cooldownStateOf(doc: {
    submitCooldownUntil: Date | null;
    submitCooldownPayloadHash: string | null;
  }): CooldownState {
    return {
      until: doc.submitCooldownUntil,
      payloadHash: doc.submitCooldownPayloadHash,
    };
  }

  private async clearCooldown(tenantId: string, documentId: string) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.update({
        where: { id: documentId },
        data: {
          submitCooldownUntil: null,
          submitCooldownPayloadHash: null,
          submitPendingRetrySubmissionId: null,
        },
      }),
    );
  }

  private async tryAcquireInFlight(tenantId: string, documentId: string) {
    const staleBefore = new Date(Date.now() - IN_FLIGHT_STALE_MS);
    const result = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.updateMany({
        where: {
          id: documentId,
          tenantId,
          OR: [
            { submitInFlight: false },
            // Recover locks stranded by a crash/restart mid-POST.
            { submitInFlightSince: null },
            { submitInFlightSince: { lt: staleBefore } },
          ],
        },
        data: { submitInFlight: true, submitInFlightSince: new Date() },
      }),
    );
    return result.count === 1;
  }

  private async releaseInFlight(tenantId: string, documentId: string) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.update({
        where: { id: documentId },
        data: { submitInFlight: false, submitInFlightSince: null },
      }),
    );
  }

  private async appendAttemptLog(
    tenantId: string,
    documentId: string,
    entry: SubmitAttemptLogEntry,
  ) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const doc = await tx.document.findFirst({
        where: { id: documentId, tenantId },
        select: { submitAttemptLog: true },
      });
      const prev = Array.isArray(doc?.submitAttemptLog)
        ? (doc!.submitAttemptLog as SubmitAttemptLogEntry[])
        : [];
      const next = [...prev, entry].slice(-50);
      await tx.document.update({
        where: { id: documentId },
        data: { submitAttemptLog: next as unknown as Prisma.InputJsonValue },
      });
    });
  }

  private async applyAccepted202(
    tenantId: string,
    submission: Submission,
    docs: Array<{ id: string; status: DocumentStatus; internalId: string }>,
    docsById: Map<string, { id: string; status: DocumentStatus; internalId: string }>,
    etaBody: Eta202Body,
    actorUserId: string | null | undefined,
    triggerSource: string,
  ) {
    const sdRows = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const sds = await tx.submissionDocument.findMany({
        where: { submissionId: submission.id },
      });
      return sds.map((sd) => {
        const doc = docsById.get(sd.documentId);
        if (!doc) {
          throw new BadRequestException(`Missing document ${sd.documentId}`);
        }
        return {
          id: sd.id,
          tenantId,
          documentId: sd.documentId,
          documentVersion: sd.documentVersion,
          internalId: sd.internalId,
          documentStatus: String(doc.status),
        };
      });
    });
    void docs;

    const mapped = apply202ResultMap(tenantId, sdRows, etaBody);
    const etaSubmissionUuidForStore = mapped.etaSubmissionUuid.startsWith(
      'intake-refused-',
    )
      ? null
      : mapped.etaSubmissionUuid;

    // Genuine 202 with neither accepted nor refused for our docs (FR-004d).
    if (mapped.needsAttention && mapped.missingFromBothArrays.length > 0) {
      this.logger.error(
        `FR-004d empty 202 arrays for submission=${submission.id} raw=${JSON.stringify(etaBody).slice(0, 2000)}`,
      );
      for (const internalId of mapped.missingFromBothArrays) {
        const row = sdRows.find((r) => r.internalId === internalId);
        if (!row) continue;
        await this.appendAttemptLog(tenantId, row.documentId, {
          at: new Date().toISOString(),
          outcome: 'empty_202',
          httpStatus: 202,
          code: 'FR004D_MISSING_FROM_BOTH_ARRAYS',
          message:
            'Genuine ETA 202 with document missing from accepted[] and rejected[]',
          triggerSource,
          rawBody: JSON.stringify(etaBody).slice(0, 2000),
        });
      }
    }

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          state: mapped.submissionState,
          etaSubmissionUuid: etaSubmissionUuidForStore,
          acceptedCount: mapped.acceptedCount,
          refusedCount: mapped.refusedCount,
          nextAttemptAt: null,
          etaRawResponseJson: etaBody as unknown as Prisma.InputJsonValue,
          lastErrorCode: mapped.needsAttention
            ? 'NEEDS_ATTENTION'
            : mapped.refusedCount > 0 && mapped.acceptedCount === 0
              ? 'REFUSED_AT_INTAKE'
              : null,
          lastErrorMessage: mapped.needsAttention
            ? mapped.needsAttentionReasons.join('; ').slice(0, 1000)
            : mapped.refusedCount > 0 && mapped.acceptedCount === 0
              ? mapped.mapped
                  .filter((m) => m.kind === 'refused')
                  .map((m) =>
                    typeof m.intakeErrorJson?.message === 'string'
                      ? m.intakeErrorJson.message
                      : 'Refused at intake',
                  )
                  .join('; ')
                  .slice(0, 1000)
              : null,
        },
      });

      for (const m of mapped.mapped) {
        await tx.submissionDocument.update({
          where: { id: m.submissionDocumentId },
          data: {
            attemptOutcome: m.attemptOutcome,
            etaUuid: m.etaUuid,
            etaLongId: m.etaLongId,
            intakeErrorJson:
              m.kind === 'refused'
                ? (m.intakeErrorJson as Prisma.InputJsonValue)
                : undefined,
          },
        });

        const fromStatus = docsById.get(m.documentId)!.status as DocumentStatus;
        const toStatus = m.documentStatus as DocumentStatus;

        if (m.kind === 'accepted') {
          await tx.document.update({
            where: { id: m.documentId },
            data: {
              status: 'SUBMITTED',
              etaUuid: m.etaUuid,
              etaLongId: m.etaLongId,
              submissionUuid: etaSubmissionUuidForStore,
              etaEnvironment: submission.etaEnvironment ?? undefined,
              needsAttention: false,
              needsAttentionReason: null,
              etaStatus: 'Submitted',
              etaStatusUpdatedAt: new Date(),
              etaStatusRaw: etaBody as unknown as Prisma.InputJsonValue,
              submitCooldownUntil: null,
              submitCooldownPayloadHash: null,
              submitPendingRetrySubmissionId: null,
              submitDuplicateRetryCount: 0,
            },
          });
          const issuedDoc = await tx.document.findUnique({
            where: { id: m.documentId },
            select: { branchId: true, currencyCode: true },
          });
          void this.usageEmit.emitIssued({
            tenantId,
            documentId: m.documentId,
            branchId: issuedDoc?.branchId,
            currencyCode: issuedDoc?.currencyCode,
          });
        } else {
          const detailMsg =
            Array.isArray(m.intakeErrorJson?.details) &&
            m.intakeErrorJson.details[0] &&
            typeof (m.intakeErrorJson.details[0] as { message?: string }).message ===
              'string'
              ? (m.intakeErrorJson.details[0] as { message: string }).message
              : null;
          const errMsg =
            detailMsg ||
            (typeof m.intakeErrorJson?.message === 'string'
              ? m.intakeErrorJson.message
              : JSON.stringify(m.intakeErrorJson));
          await tx.document.update({
            where: { id: m.documentId },
            data: {
              status: 'SIGNED',
              needsAttention: true,
              needsAttentionReason: `ETA refused at intake: ${errMsg}`.slice(
                0,
                1000,
              ),
              submissionUuid: etaSubmissionUuidForStore,
              etaStatusRaw: etaBody as unknown as Prisma.InputJsonValue,
              etaStatusUpdatedAt: new Date(),
              submitCooldownUntil: null,
              submitCooldownPayloadHash: null,
              submitPendingRetrySubmissionId: null,
            },
          });
        }

        if (fromStatus !== toStatus) {
          await tx.documentStatusEvent.create({
            data: {
              tenantId,
              documentId: m.documentId,
              fromStatus,
              toStatus,
              source: 'eta',
              actorUserId: actorUserId ?? null,
              reason:
                m.kind === 'accepted'
                  ? `Accepted submissionUUID=${etaSubmissionUuidForStore}`
                  : `Refused at intake`,
              etaStatusRawSnapshot: etaBody as unknown as Prisma.InputJsonValue,
            },
          });
          if (toStatus === 'VALID' || toStatus === 'INVALID') {
            void this.usageEmit.emitDocumentOutcome({
              tenantId,
              documentId: m.documentId,
              toStatus,
            });
          }
        }
      }

      for (const lock of mapped.filingLocks) {
        await tx.documentFilingLock.upsert({
          where: {
            tenantId_documentId_documentVersion: {
              tenantId: lock.tenantId,
              documentId: lock.documentId,
              documentVersion: lock.documentVersion,
            },
          },
          create: {
            tenantId: lock.tenantId,
            documentId: lock.documentId,
            documentVersion: lock.documentVersion,
            submissionDocumentId: lock.submissionDocumentId,
          },
          update: {},
        });
      }
    });

    for (const m of mapped.mapped) {
      await this.appendAttemptLog(tenantId, m.documentId, {
        at: new Date().toISOString(),
        outcome: m.kind === 'accepted' ? 'accepted' : 'refused',
        code: m.kind === 'accepted' ? 'ACCEPTED' : 'REFUSED_AT_INTAKE',
        message:
          m.kind === 'accepted'
            ? `uuid=${m.etaUuid}`
            : JSON.stringify(m.intakeErrorJson),
        triggerSource,
      });
    }

    await this.audit.write({
      action: 'submissions.eta_202_applied',
      outcome: mapped.acceptedCount > 0 ? 'success' : 'failure',
      actorUserId: actorUserId ?? undefined,
      tenantId,
      resourceType: 'submission',
      resourceId: submission.id,
      metadata: {
        submissionUUID: etaSubmissionUuidForStore,
        accepted: mapped.acceptedCount,
        refused: mapped.refusedCount,
        state: mapped.submissionState,
      },
    });
  }

  private async failSubmission(
    tenantId: string,
    submission: Submission,
    code: string,
    message: string,
    actorUserId?: string | null,
  ) {
    const reason = `${code}: ${message}`.slice(0, 1000);
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          state: 'NEEDS_ATTENTION',
          lastErrorCode: code,
          lastErrorMessage: reason,
        },
      });
      const sds = await tx.submissionDocument.findMany({
        where: { submissionId: submission.id },
      });
      for (const sd of sds) {
        await tx.document.update({
          where: { id: sd.documentId },
          data: {
            needsAttention: true,
            needsAttentionReason: reason,
          },
        });
      }
    });

    await this.audit.write({
      action: 'submissions.failed',
      outcome: 'failure',
      actorUserId: actorUserId ?? undefined,
      tenantId,
      resourceType: 'submission',
      resourceId: submission.id,
      metadata: { code, message: reason },
    });
  }

  private async markDocumentVisibleFailure(
    tenantId: string,
    documentId: string,
    code: string,
    message: string,
  ) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.update({
        where: { id: documentId },
        data: {
          needsAttention: true,
          needsAttentionReason: `${code}: ${message}`.slice(0, 1000),
        },
      }),
    );
  }

  private toDetail(
    row: Submission & {
      documents: Array<{
        documentId: string;
        internalId: string;
        attemptOutcome: string;
        etaUuid: string | null;
        etaLongId: string | null;
        intakeErrorJson: Prisma.JsonValue | null;
        document?: { status: DocumentStatus };
      }>;
    },
  ): SubmissionDetail {
    return {
      id: row.id,
      state: row.state,
      etaSubmissionUuid: row.etaSubmissionUuid,
      documentCount: row.documentCount,
      acceptedCount: row.acceptedCount,
      refusedCount: row.refusedCount,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      triggerSource: row.triggerSource,
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      isTransientCooldown: row.state === 'WAITING_COOLDOWN',
      etaRawResponse: row.etaRawResponseJson ?? null,
      documents: row.documents.map((d) => ({
        documentId: d.documentId,
        internalId: d.internalId,
        attemptOutcome: d.attemptOutcome,
        etaUuid: d.etaUuid,
        etaLongId: d.etaLongId,
        intakeError: d.intakeErrorJson,
        documentStatus: d.document?.status ?? 'UNKNOWN',
      })),
    };
  }
}

/** Generate a unique key only when caller needs a fresh batch (rare). */
export function newSubmitIdempotencyKey(documentId: string): string {
  return `manual:${documentId}:${randomUUID()}`;
}
