import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma, Receipt, ReceiptStatus } from '@prisma/client';
import {
  buildReceiptSubmitBody,
  ReceiptSignatureRequiredError,
  splitReceiptBatch,
  type ReceiptJsonObject,
} from '@einvoice/eta-core';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtaService } from '../eta/eta.service';
import { EtaReceiptSubmitClient } from '../eta/eta-receipt-submit.client';
import {
  EtaReceiptStatusClient,
  extractReceiptEtaStatus,
  normalizeReceiptEtaStatus,
} from '../eta/eta-receipt-status.client';
import { EtaSubmitError } from '../eta/eta-submit.client';
import {
  evaluateCooldown,
  IN_FLIGHT_STALE_MS,
  isInFlightHeld,
} from '../submissions/submit-cooldown';
import { MAX_DUPLICATE_RETRIES } from '../submissions/duplicate-submission';
import { lastUuidAfterAccept, lastUuidAfterReject } from './receipt-chain';
import { receiptSigningFromEnv } from './receipt-signing.resolver';

const PLACEHOLDER_POLL_MS = 800;
const PLACEHOLDER_POLL_TRIES = 4;

@Injectable()
export class ReceiptSubmitService {
  private readonly logger = new Logger(ReceiptSubmitService.name);
  private readonly delayedRetries = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eta: EtaService,
    private readonly audit: AuditService,
  ) {}

  async submit(
    tenantId: string,
    actorUserId: string,
    receiptId: string,
    opts?: { triggerSource?: string },
  ) {
    const triggerSource = opts?.triggerSource ?? 'manual';
    const row = await this.load(tenantId, receiptId);
    if (row.status === 'VALID' && row.submissionUuid) {
      return { outcome: 'already_accepted' as const, receiptId };
    }
    if (row.status === 'SUBMITTED' && row.submissionUuid) {
      await this.syncStatus(tenantId, receiptId);
      return { outcome: 'polled' as const, receiptId };
    }

    if (
      isInFlightHeld(row.submitInFlight, row.submitInFlightSince, Date.now(), IN_FLIGHT_STALE_MS)
    ) {
      throw new ConflictException({
        code: 'RECEIPT_SUBMIT_IN_FLIGHT',
        message: 'This receipt is already being submitted.',
      });
    }

    const payload = this.receiptJson(row);
    const signing = receiptSigningFromEnv();
    let body;
    try {
      body = await buildReceiptSubmitBody([payload], signing);
    } catch (err) {
      if (err instanceof ReceiptSignatureRequiredError) {
        throw new BadRequestException({
          code: err.code,
          message: err.message,
        });
      }
      throw err;
    }

    const hash = this.payloadHash(body);
    const cooldown = evaluateCooldown(
      {
        until: row.submitCooldownUntil,
        payloadHash: row.submitCooldownPayloadHash,
      },
      hash,
    );
    if (cooldown.blocked) {
      throw new ConflictException({
        code: 'ETA_DUPLICATE_COOLDOWN',
        message: `ETA duplicate window — retry after ${cooldown.remainingSeconds}s.`,
        submitCooldownUntil: cooldown.until.toISOString(),
        remainingSeconds: cooldown.remainingSeconds,
      });
    }

    await this.markInFlight(tenantId, receiptId, true);

    try {
      await this.postChunks(tenantId, actorUserId, row, [payload], triggerSource);
    } finally {
      await this.markInFlight(tenantId, receiptId, false);
    }

    return { outcome: 'submitted' as const, receiptId };
  }

  async syncStatus(tenantId: string, receiptId: string) {
    const row = await this.load(tenantId, receiptId);
    if (!row.submissionUuid && !row.uuid) {
      return { outcome: 'noop' as const };
    }
    const apiBaseUrl = await this.eta.getApiBaseUrl(tenantId);
    const statusClient = new EtaReceiptStatusClient(apiBaseUrl);
    const raw = await this.eta.withPosAccessToken(
      tenantId,
      row.posDeviceId,
      undefined,
      async (token) => {
        if (row.submissionUuid && !row.submissionUuid.startsWith('intake-refused-')) {
          try {
            return await statusClient.getSubmissionDetails(token, row.submissionUuid);
          } catch {
            /* fall through to receipt details */
          }
        }
        if (row.uuid) {
          return statusClient.getReceiptDetails(token, row.uuid);
        }
        return {};
      },
    );
    const etaStatus = normalizeReceiptEtaStatus(extractReceiptEtaStatus(raw));
    await this.applyPolledStatus(tenantId, row, etaStatus, raw);
    return { outcome: 'synced' as const, etaStatus };
  }

  private async postChunks(
    tenantId: string,
    actorUserId: string,
    row: Receipt,
    receipts: ReceiptJsonObject[],
    triggerSource: string,
  ) {
    const apiBaseUrl = await this.eta.getApiBaseUrl(tenantId);
    const client = new EtaReceiptSubmitClient(apiBaseUrl);
    const chunks = splitReceiptBatch(receipts);

    for (const chunk of chunks) {
      const signing = receiptSigningFromEnv();
      const body = await buildReceiptSubmitBody(chunk, signing);
      try {
        const etaBody = await this.eta.withPosAccessToken(
          tenantId,
          row.posDeviceId,
          undefined,
          (token) => client.postReceiptSubmissions(token, body),
        );
        await this.apply202(tenantId, row, etaBody, actorUserId);
        if (row.uuid && etaBody.acceptedDocuments.some((d) => d.uuid === row.uuid)) {
          await this.pollUntilTerminal(tenantId, row.id);
        }
      } catch (err) {
        if (err instanceof EtaSubmitError && err.code === 'ETA_MAXIMUM_SIZE_EXCEEDED' && chunk.length > 1) {
          const halves = splitReceiptBatch(chunk, {
            maxCount: Math.max(1, Math.ceil(chunk.length / 2)),
          });
          for (const half of halves) {
            await this.postChunks(
              tenantId,
              actorUserId,
              row,
              half,
              triggerSource,
            );
          }
          continue;
        }
        if (err instanceof EtaSubmitError && err.isDuplicate) {
          await this.handleDuplicate(tenantId, row, err, actorUserId, triggerSource, body);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof EtaSubmitError ? err.code : 'eta_submit_failed';
        await this.fail(tenantId, row, code, message);
        throw err instanceof EtaSubmitError
          ? new BadRequestException({
              code,
              message,
              httpStatus: err.httpStatus,
            })
          : err;
      }
    }
  }

  private async apply202(
    tenantId: string,
    row: Receipt,
    etaBody: {
      submissionUUID: string;
      acceptedDocuments: Array<{ uuid?: string; longId?: string; receiptNumber?: string }>;
      rejectedDocuments: Array<{
        uuid?: string;
        receiptNumber?: string;
        error?: { message?: string };
      }>;
    },
    actorUserId: string,
  ) {
    const accepted = etaBody.acceptedDocuments.find(
      (d) => d.uuid === row.uuid || d.receiptNumber === row.receiptNumber,
    );
    const rejected = etaBody.rejectedDocuments.find(
      (d) => d.uuid === row.uuid || d.receiptNumber === row.receiptNumber,
    );
    const environment = await this.eta.getActiveEnvironment(tenantId);

    if (rejected) {
      await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        await tx.receipt.update({
          where: { id: row.id },
          data: {
            status: 'INVALID',
            etaStatus: 'Invalid',
            submissionUuid: etaBody.submissionUUID,
            etaStatusRaw: etaBody as unknown as Prisma.InputJsonValue,
            etaStatusUpdatedAt: new Date(),
            lastErrorCode: 'ETA_REJECTED',
            lastErrorMessage: rejected.error?.message?.slice(0, 1000) ?? 'Rejected by ETA',
            submitAttemptCount: { increment: 1 },
          },
        });
        await this.rollbackChain(tx, tenantId, row);
      });
      await this.audit.write({
        action: 'receipt.submit.rejected',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'receipt',
        resourceId: row.id,
        metadata: { submissionUuid: etaBody.submissionUUID },
      });
      return;
    }

    const nextStatus: ReceiptStatus = 'SUBMITTED';
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.receipt.update({
        where: { id: row.id },
        data: {
          status: nextStatus,
          etaStatus: 'InProgress',
          etaLongId: accepted?.longId ?? row.etaLongId,
          submissionUuid: etaBody.submissionUUID,
          etaStatusRaw: etaBody as unknown as Prisma.InputJsonValue,
          etaStatusUpdatedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          submitAttemptCount: { increment: 1 },
          etaEnvironment: environment,
        },
      });
      await this.advanceChain(tx, tenantId, row);
    });
    await this.audit.write({
      action: 'receipt.submit.accepted',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'receipt',
      resourceId: row.id,
      metadata: {
        submissionUuid: etaBody.submissionUUID,
        longId: accepted?.longId,
        signed: false,
      },
    });
  }

  private async pollUntilTerminal(tenantId: string, receiptId: string) {
    for (let i = 0; i < PLACEHOLDER_POLL_TRIES; i += 1) {
      await new Promise((r) => setTimeout(r, PLACEHOLDER_POLL_MS));
      const { etaStatus } = await this.syncStatus(tenantId, receiptId);
      if (etaStatus === 'Valid' || etaStatus === 'Invalid' || etaStatus === 'Cancelled') {
        return;
      }
    }
  }

  private async applyPolledStatus(
    tenantId: string,
    row: Receipt,
    etaStatus: string | null,
    raw: Record<string, unknown>,
  ) {
    if (!etaStatus) return;
    const mapped: ReceiptStatus | null =
      etaStatus === 'Valid'
        ? 'VALID'
        : etaStatus === 'Invalid'
          ? 'INVALID'
          : etaStatus === 'InProgress'
            ? 'SUBMITTED'
            : null;
    if (!mapped) return;

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.receipt.update({
        where: { id: row.id },
        data: {
          status: mapped,
          etaStatus,
          etaStatusRaw: raw as Prisma.InputJsonValue,
          etaStatusUpdatedAt: new Date(),
          ...(mapped === 'INVALID'
            ? {
                lastErrorCode: 'ETA_INVALID',
                lastErrorMessage: 'ETA marked this receipt Invalid.',
              }
            : mapped === 'VALID'
              ? { lastErrorCode: null, lastErrorMessage: null }
              : {}),
        },
      });
      if (mapped === 'VALID') {
        await this.advanceChain(tx, tenantId, row);
      }
      if (mapped === 'INVALID') {
        await this.rollbackChain(tx, tenantId, row);
      }
    });
  }

  private async advanceChain(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: Receipt,
  ) {
    const pos = await tx.posDevice.findFirst({
      where: { id: row.posDeviceId, tenantId },
    });
    if (!pos) return;
    const next = lastUuidAfterAccept(pos.lastReceiptUuid, row.uuid, row.previousUuid);
    if (next === pos.lastReceiptUuid) return;
    await tx.posDevice.updateMany({
      where: { id: pos.id, tenantId, lastReceiptUuid: pos.lastReceiptUuid },
      data: { lastReceiptUuid: next },
    });
  }

  private async rollbackChain(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: Receipt,
  ) {
    const pos = await tx.posDevice.findFirst({
      where: { id: row.posDeviceId, tenantId },
    });
    if (!pos) return;
    const next = lastUuidAfterReject(pos.lastReceiptUuid, row.uuid, row.previousUuid);
    if (next === pos.lastReceiptUuid) return;
    const child = await tx.receipt.findFirst({
      where: { tenantId, posDeviceId: row.posDeviceId, previousUuid: row.uuid },
    });
    if (child) return;
    await tx.posDevice.updateMany({
      where: { id: pos.id, tenantId, lastReceiptUuid: pos.lastReceiptUuid },
      data: { lastReceiptUuid: next },
    });
  }

  private async handleDuplicate(
    tenantId: string,
    row: Receipt,
    err: EtaSubmitError,
    actorUserId: string,
    triggerSource: string,
    body: unknown,
  ) {
    const waitSec = err.retryAfterSeconds ?? 600;
    const cooldownUntil = new Date(Date.now() + waitSec * 1000);
    const nextRetry = (row.submitDuplicateRetryCount ?? 0) + 1;
    const schedule = nextRetry <= MAX_DUPLICATE_RETRIES;
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.update({
        where: { id: row.id },
        data: {
          submitCooldownUntil: cooldownUntil,
          submitCooldownPayloadHash: this.payloadHash(body),
          submitDuplicateRetryCount: nextRetry,
          lastErrorCode: 'ETA_DUPLICATE_SUBMISSION',
          lastErrorMessage: `Transient cooldown ${waitSec}s`,
        },
      }),
    );
    await this.audit.write({
      action: 'receipt.submit.duplicate_cooldown',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'receipt',
      resourceId: row.id,
      metadata: { waitSec, triggerSource },
    });
    if (schedule) {
      this.scheduleExactlyOneDelayedRetry(tenantId, row.id, actorUserId, waitSec);
    }
  }

  private scheduleExactlyOneDelayedRetry(
    tenantId: string,
    receiptId: string,
    actorUserId: string,
    waitSec: number,
  ) {
    const existing = this.delayedRetries.get(receiptId);
    if (existing) clearTimeout(existing);
    const delayMs = (waitSec + 2) * 1000;
    this.logger.log(
      `Scheduling exactly ONE delayed receipt retry receipt=${receiptId} in ${waitSec}+2s`,
    );
    const timer = setTimeout(() => {
      this.delayedRetries.delete(receiptId);
      void this.submit(tenantId, actorUserId, receiptId, {
        triggerSource: 'duplicate_retry',
      }).catch((err) => {
        this.logger.warn(
          `Delayed receipt retry failed receipt=${receiptId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.delayedRetries.set(receiptId, timer);
  }

  private async fail(tenantId: string, row: Receipt, code: string, message: string) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.update({
        where: { id: row.id },
        data: {
          lastErrorCode: code,
          lastErrorMessage: message.slice(0, 1000),
          submitAttemptCount: { increment: 1 },
        },
      }),
    );
  }

  private async markInFlight(tenantId: string, id: string, on: boolean) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.update({
        where: { id },
        data: on
          ? { submitInFlight: true, submitInFlightSince: new Date() }
          : { submitInFlight: false, submitInFlightSince: null },
      }),
    );
  }

  private async load(tenantId: string, id: string): Promise<Receipt> {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receipt.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException('Receipt not found');
    return row;
  }

  private receiptJson(row: Receipt): ReceiptJsonObject {
    try {
      return JSON.parse(row.etaPayloadText) as ReceiptJsonObject;
    } catch {
      return (row.etaPayloadJson ?? {}) as ReceiptJsonObject;
    }
  }

  private payloadHash(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }
}
