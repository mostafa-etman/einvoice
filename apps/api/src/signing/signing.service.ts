import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SignatureJob, type SignatureJobStatus, type SigningDevice } from '@prisma/client';
import { parseEtaDocument } from '@einvoice/eta-core';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { assertDocumentCanMutate } from '../documents/documents-mutability';

export const CLAIM_LEASE_MINUTES = 5;
/** PENDING with no progress for this long may be cancelled so the document can be re-queued. */
export const PENDING_STALE_MINUTES = 30;
export const PENDING_STALE_MS = PENDING_STALE_MINUTES * 60_000;

export function isClaimLeaseActive(
  claimExpiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return Boolean(claimExpiresAt && claimExpiresAt.getTime() > now.getTime());
}

export function isPendingJobStale(
  updatedAt: Date,
  now: Date = new Date(),
  staleMs: number = PENDING_STALE_MS,
): boolean {
  return now.getTime() - updatedAt.getTime() >= staleMs;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export type SignatureJobSummary = {
  id: string;
  documentId: string;
  documentVersion: number;
  status: SignatureJobStatus;
  claimedByDeviceId: string | null;
  failureCode: string | null;
  createdAt: string;
};

function toSummary(job: SignatureJob): SignatureJobSummary {
  return {
    id: job.id,
    documentId: job.documentId,
    documentVersion: job.documentVersion,
    status: job.status,
    claimedByDeviceId: job.claimedByDeviceId,
    failureCode: job.failureCode,
    createdAt: job.createdAt.toISOString(),
  };
}

@Injectable()
export class SigningService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly submissions: SubmissionsService,
  ) {}

  async sendForSignature(tenantId: string, actorUserId: string, documentId: string) {
    let result: { job: SignatureJob; created: boolean; recovered: boolean } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await this.enqueueOrReuseJob(tenantId, documentId);
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 2) throw err;
      }
    }
    if (!result) throw new ConflictException('Could not enqueue signature job');

    if (result.created) {
      await this.audit.write({
        action: 'documents.send_for_signature',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'signature_job',
        resourceId: result.job.id,
        metadata: {
          documentId,
          documentVersion: result.job.documentVersion,
          recovered: result.recovered,
        },
      });
    }

    return toSummary(result.job);
  }

  /**
   * Idempotent enqueue: at most one PENDING/CLAIMED job per document.
   * Serializes on the document row so concurrent clicks cannot insert two actives.
   */
  private async enqueueOrReuseJob(tenantId: string, documentId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const doc = await tx.document.findFirst({ where: { id: documentId, tenantId } });
      if (!doc) throw new NotFoundException('Document not found');
      assertDocumentCanMutate(doc.origin, doc.status);
      if (doc.status !== 'READY') {
        throw new BadRequestException('Document must be READY to send for signature');
      }
      // The signature covers the exact stored bytes; without them we would sign
      // a key-reordered jsonb copy and ETA would reject the message-digest.
      if (!doc.etaPayloadText) {
        throw new BadRequestException(
          'Document payload predates exact-bytes storage. Open the document, save it again, then send for signature.',
        );
      }

      await tx.$queryRaw`
        SELECT id FROM documents WHERE id = ${documentId}::uuid FOR UPDATE
      `;

      const now = new Date();
      const active = await tx.signatureJob.findFirst({
        where: { tenantId, documentId, status: { in: ['PENDING', 'CLAIMED'] } },
      });

      if (active?.status === 'CLAIMED') {
        if (isClaimLeaseActive(active.claimExpiresAt, now)) {
          return { job: active, created: false, recovered: false };
        }
        const released = await tx.signatureJob.updateMany({
          where: {
            id: active.id,
            status: 'CLAIMED',
            OR: [{ claimExpiresAt: { lt: now } }, { claimExpiresAt: null }],
          },
          data: { status: 'PENDING', claimedByDeviceId: null, claimExpiresAt: null },
        });
        const afterRelease = await tx.signatureJob.findFirst({
          where: { id: active.id },
        });
        if (released.count === 1 && afterRelease) {
          return { job: afterRelease, created: false, recovered: true };
        }
        if (afterRelease && afterRelease.status !== 'CLAIMED') {
          return { job: afterRelease, created: false, recovered: false };
        }
        const again = await tx.signatureJob.findFirst({
          where: { tenantId, documentId, status: { in: ['PENDING', 'CLAIMED'] } },
        });
        if (again) return { job: again, created: false, recovered: false };
      }

      if (active?.status === 'PENDING') {
        if (!isPendingJobStale(active.updatedAt, now)) {
          return { job: active, created: false, recovered: false };
        }
        const cancelled = await tx.signatureJob.updateMany({
          where: { id: active.id, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            failureCode: 'STALE_PENDING',
            completedAt: now,
          },
        });
        if (cancelled.count !== 1) {
          const again = await tx.signatureJob.findFirst({
            where: { tenantId, documentId, status: { in: ['PENDING', 'CLAIMED'] } },
          });
          if (again) return { job: again, created: false, recovered: false };
        }
      }

      const created = await tx.signatureJob.create({
        data: {
          tenantId,
          documentId,
          documentVersion: doc.version,
          status: 'PENDING',
        },
      });
      return { job: created, created: true, recovered: active?.status === 'PENDING' };
    });
  }

  async listJobs(tenantId: string, status?: SignatureJobStatus, documentId?: string) {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.signatureJob.findMany({
        where: {
          tenantId,
          ...(status ? { status } : {}),
          ...(documentId ? { documentId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
    return rows.map(toSummary);
  }

  /** CAS claim: only rows still PENDING at UPDATE time transition to CLAIMED. */
  async claim(device: SigningDevice, max = 1) {
    const limit = Math.min(Math.max(max, 1), 10);
    const claimExpiresAt = new Date(Date.now() + CLAIM_LEASE_MINUTES * 60_000);

    const jobs = await this.tenantPrisma.withTenant(device.tenantId, async (tx) => {
      const now = new Date();
      // Release stale leases before offering new candidates.
      await tx.signatureJob.updateMany({
        where: { tenantId: device.tenantId, status: 'CLAIMED', claimExpiresAt: { lt: now } },
        data: { status: 'PENDING', claimedByDeviceId: null, claimExpiresAt: null },
      });

      const candidates = await tx.signatureJob.findMany({
        where: { tenantId: device.tenantId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      const claimed: SignatureJob[] = [];
      for (const candidate of candidates) {
        const result = await tx.signatureJob.updateMany({
          where: { id: candidate.id, status: 'PENDING' },
          data: { status: 'CLAIMED', claimedByDeviceId: device.id, claimExpiresAt },
        });
        if (result.count === 1) {
          claimed.push({ ...candidate, status: 'CLAIMED', claimedByDeviceId: device.id, claimExpiresAt });
        }
      }
      return claimed;
    });

    if (jobs.length) {
      await this.audit.write({
        action: 'signing.job.claim',
        outcome: 'success',
        tenantId: device.tenantId,
        resourceType: 'signature_job',
        resourceId: jobs.map((j) => j.id).join(','),
        metadata: { deviceId: device.id, count: jobs.length },
      });
    }

    const withPayload = await this.tenantPrisma.withTenant(device.tenantId, (tx) =>
      Promise.all(
        jobs.map(async (job) => {
          const doc = await tx.document.findFirst({ where: { id: job.documentId } });
          // Field order is part of the ETA canonical string, so both shapes are
          // derived from the stored bytes: etaPayloadText is exact, and
          // etaPayload is re-parsed from it (order-preserving) so agents that
          // read the object form still sign the same canonical string. The
          // jsonb column is never used here — it reorders keys.
          const payloadText = doc?.etaPayloadText ?? null;
          return {
            jobId: job.id,
            documentId: job.documentId,
            documentVersion: job.documentVersion,
            etaPayloadText: payloadText,
            etaPayload: payloadText ? parseEtaDocument(payloadText) : null,
          };
        }),
      ),
    );

    return { jobs: withPayload };
  }

  async submit(
    device: SigningDevice,
    jobId: string,
    dto: {
      documentId: string;
      documentVersion: number;
      signatureType: string;
      cadesBase64: string;
      certificateThumbprint?: string;
    },
  ) {
    if (dto.signatureType !== 'I') {
      throw new BadRequestException('Only signatureType "I" (issuer) is supported');
    }
    if (!dto.cadesBase64) {
      throw new BadRequestException('cadesBase64 is required');
    }

    const result = await this.tenantPrisma.withTenant(device.tenantId, async (tx) => {
      const job = await tx.signatureJob.findFirst({
        where: { id: jobId, tenantId: device.tenantId },
      });
      if (!job) throw new NotFoundException('Signature job not found');
      if (job.documentId !== dto.documentId) {
        throw new BadRequestException('documentId does not match job');
      }

      const doc = await tx.document.findFirst({
        where: { id: dto.documentId, tenantId: device.tenantId },
      });
      if (!doc) throw new NotFoundException('Document not found');

      // Idempotent: retried submit for an already-completed job with the same
      // version is a no-op success (FR-009).
      if (job.status === 'COMPLETED') {
        if (job.documentVersion !== dto.documentVersion) {
          throw new ConflictException('Document version mismatch');
        }
        return { job, doc, idempotent: true };
      }

      if (job.status !== 'CLAIMED') {
        throw new BadRequestException(`Job is not claimed (status: ${job.status})`);
      }
      if (job.claimedByDeviceId !== device.id) {
        throw new ForbiddenException('Job claimed by a different device');
      }
      if (job.documentVersion !== dto.documentVersion || doc.version !== dto.documentVersion) {
        throw new ConflictException('Document version mismatch');
      }

      const signature = {
        signatureType: 'I' as const,
        value: dto.cadesBase64,
        ...(dto.certificateThumbprint
          ? { certificateThumbprint: dto.certificateThumbprint }
          : {}),
      };

      const updatedDoc = await tx.document.update({
        where: { id: doc.id },
        data: {
          status: 'SIGNED',
          signaturesJson: [signature] as unknown as Prisma.InputJsonValue,
          signedAt: new Date(),
          signedByDeviceId: device.id,
        },
      });

      const updatedJob = await tx.signatureJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      return { job: updatedJob, doc: updatedDoc, idempotent: false };
    });

    await this.audit.write({
      action: 'signing.job.complete',
      outcome: 'success',
      tenantId: device.tenantId,
      resourceType: 'signature_job',
      resourceId: jobId,
      metadata: {
        deviceId: device.id,
        documentId: dto.documentId,
        idempotent: result.idempotent,
      },
    });

    // FR-040: agent-signed documents auto-enqueue for ETA submission.
    // Failures stay visible on the document; SIGNED is never rolled back.
    let submission: Awaited<
      ReturnType<SubmissionsService['enqueueAfterAgentSign']>
    > = null;
    if (!result.idempotent) {
      submission = await this.submissions.enqueueAfterAgentSign(
        device.tenantId,
        result.doc.id,
        result.doc.version,
      );
    }

    return {
      jobId: result.job.id,
      documentId: result.doc.id,
      status: result.job.status,
      documentStatus: result.doc.status,
      submissionId: submission?.id ?? null,
      submissionState: submission?.state ?? null,
      etaSubmissionUuid: submission?.etaSubmissionUuid ?? null,
    };
  }

  async fail(
    device: SigningDevice,
    jobId: string,
    dto: { code: string; message?: string },
  ) {
    await this.tenantPrisma.withTenant(device.tenantId, async (tx) => {
      const job = await tx.signatureJob.findFirst({
        where: { id: jobId, tenantId: device.tenantId },
      });
      if (!job) throw new NotFoundException('Signature job not found');
      if (job.status === 'FAILED') return;
      if (job.status !== 'CLAIMED') {
        throw new BadRequestException(`Job is not claimed (status: ${job.status})`);
      }
      if (job.claimedByDeviceId !== device.id) {
        throw new ForbiddenException('Job claimed by a different device');
      }
      await tx.signatureJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', failureCode: dto.code },
      });
    });

    await this.audit.write({
      action: 'signing.job.fail',
      outcome: 'failure',
      tenantId: device.tenantId,
      resourceType: 'signature_job',
      resourceId: jobId,
      metadata: { deviceId: device.id, code: dto.code },
    });

    return { ok: true };
  }
}
