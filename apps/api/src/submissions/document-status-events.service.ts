import { Injectable } from '@nestjs/common';
import type { DocumentStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsageEmitService } from '../analytics/usage-emit.service';
import { mapEtaStatusToLocal } from '../eta/eta-status-map';

@Injectable()
export class DocumentStatusEventsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly usageEmit: UsageEmitService,
  ) {}

  async record(
    tenantId: string,
    documentId: string,
    fromStatus: DocumentStatus,
    toStatus: DocumentStatus,
    opts?: {
      source?: 'system' | 'eta' | 'user';
      actorUserId?: string | null;
      reason?: string | null;
      etaStatusRawSnapshot?: Prisma.InputJsonValue;
    },
  ) {
    if (fromStatus === toStatus) return;
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.documentStatusEvent.create({
        data: {
          tenantId,
          documentId,
          fromStatus,
          toStatus,
          source: opts?.source ?? 'system',
          actorUserId: opts?.actorUserId ?? null,
          reason: opts?.reason ?? null,
          etaStatusRawSnapshot: opts?.etaStatusRawSnapshot,
        },
      }),
    );
    if (toStatus === 'VALID' || toStatus === 'INVALID') {
      await this.usageEmit.emitDocumentOutcome({
        tenantId,
        documentId,
        toStatus,
      });
    }
  }

  /**
   * Apply ETA poll/webhook status onto the document and emit metering
   * (valid/invalid supersede). Used by poll workers / status sync.
   */
  async applyEtaStatus(
    tenantId: string,
    documentId: string,
    etaStatus: string,
    opts?: { actorUserId?: string | null; raw?: Prisma.InputJsonValue },
  ): Promise<DocumentStatus | null> {
    const local = mapEtaStatusToLocal(etaStatus);
    if (!local) return null;

    const change = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const doc = await tx.document.findFirst({
        where: { id: documentId, tenantId },
      });
      if (!doc) return null;
      const fromStatus = doc.status;
      // Always stamp last-checked time on a successful ETA query, even when
      // the mapped status is unchanged (manual refresh UX).
      if (fromStatus === local) {
        await tx.document.update({
          where: { id: documentId },
          data: {
            etaStatus,
            etaStatusUpdatedAt: new Date(),
            etaStatusRaw: opts?.raw,
          },
        });
        return { fromStatus, toStatus: fromStatus, changed: false };
      }
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: local as DocumentStatus,
          etaStatus,
          etaStatusUpdatedAt: new Date(),
          etaStatusRaw: opts?.raw,
        },
      });
      return {
        fromStatus,
        toStatus: local as DocumentStatus,
        changed: true,
      };
    });

    if (!change) return null;
    if (change.changed) {
      await this.record(tenantId, documentId, change.fromStatus, change.toStatus, {
        source: 'eta',
        actorUserId: opts?.actorUserId,
        reason: `ETA status=${etaStatus}`,
        etaStatusRawSnapshot: opts?.raw,
      });
    }
    return change.toStatus;
  }
}
