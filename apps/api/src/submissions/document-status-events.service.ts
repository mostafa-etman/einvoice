import { Injectable } from '@nestjs/common';
import type { DocumentStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Injectable()
export class DocumentStatusEventsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

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
  }
}
