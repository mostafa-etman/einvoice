import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  DocumentsService,
  type DocumentUpsertDto,
} from '../documents/documents.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { isOverlappingClash } from './conflict-classify';

export type DraftSyncBody = DocumentUpsertDto & {
  clientIdempotencyKey?: string;
};

export type DraftSyncResult = {
  id: string;
  syncRevision: number;
  clientIdempotencyKey: string;
  status: string;
};

@Injectable()
export class SyncService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  async upsertDraft(
    tenantId: string,
    actorUserId: string,
    idempotencyKey: string | undefined,
    ifMatchRevision: number | undefined,
    body: DraftSyncBody,
  ): Promise<{ statusCode: 200 | 201; result: DraftSyncResult }> {
    const key = (idempotencyKey ?? body.clientIdempotencyKey ?? '').trim();
    if (key.length < 8) {
      throw new BadRequestException(
        'Idempotency-Key must be at least 8 characters',
      );
    }

    const existing = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({
        where: { tenantId, clientIdempotencyKey: key },
        include: {
          lines: { include: { taxes: true }, orderBy: { lineNumber: 'asc' } },
        },
      }),
    );

    if (existing) {
      // Pure resync (no If-Match): return existing — never create a second row.
      if (ifMatchRevision === undefined) {
        await this.audit.write({
          action: 'sync.draft.idempotent_replay',
          outcome: 'success',
          actorUserId,
          tenantId,
          resourceType: 'document',
          resourceId: existing.id,
          metadata: { clientIdempotencyKey: key, syncRevision: existing.syncRevision },
        });
        return {
          statusCode: 200,
          result: {
            id: existing.id,
            syncRevision: existing.syncRevision,
            clientIdempotencyKey: key,
            status: existing.status,
          },
        };
      }

      const serverSnapshot = this.serverSnapshot(existing);
      const localSnapshot = body as unknown as Record<string, unknown>;
      const { clash, paths } = isOverlappingClash(
        ifMatchRevision,
        existing.syncRevision,
        localSnapshot,
        serverSnapshot,
      );

      if (clash) {
        const conflict = await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.syncConflict.create({
            data: {
              tenantId,
              documentId: existing.id,
              clientIdempotencyKey: key,
              localSnapshotJson: localSnapshot as Prisma.InputJsonValue,
              serverSnapshotJson: serverSnapshot as Prisma.InputJsonValue,
              conflictingPathsJson: paths as unknown as Prisma.InputJsonValue,
              status: 'OPEN',
            },
          }),
        );
        await this.audit.write({
          action: 'sync.draft.conflict',
          outcome: 'failure',
          actorUserId,
          tenantId,
          resourceType: 'sync_conflict',
          resourceId: conflict.id,
          metadata: { documentId: existing.id, paths },
        });
        throw new ConflictException({
          conflictId: conflict.id,
          documentId: existing.id,
          local: localSnapshot,
          server: serverSnapshot,
          conflictingPaths: paths,
        });
      }

      const updated = await this.documents.update(
        tenantId,
        actorUserId,
        existing.id,
        { ...body, version: existing.version },
      );
      const bumped = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.document.update({
          where: { id: existing.id },
          data: { syncRevision: { increment: 1 } },
          select: { syncRevision: true, status: true },
        }),
      );
      await this.audit.write({
        action: 'sync.draft.upsert',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'document',
        resourceId: existing.id,
        metadata: { clientIdempotencyKey: key, syncRevision: bumped.syncRevision },
      });
      return {
        statusCode: 200,
        result: {
          id: String(updated.id),
          syncRevision: bumped.syncRevision,
          clientIdempotencyKey: key,
          status: String(updated.status),
        },
      };
    }

    const created = await this.documents.create(tenantId, actorUserId, body, {
      clientIdempotencyKey: key,
    });
    await this.audit.write({
      action: 'sync.draft.upsert',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'document',
      resourceId: String(created.id),
      metadata: { clientIdempotencyKey: key, created: true },
    });
    return {
      statusCode: 201,
      result: {
        id: String(created.id),
        syncRevision: Number(created.syncRevision ?? 1),
        clientIdempotencyKey: key,
        status: String(created.status),
      },
    };
  }

  async resolveConflict(
    tenantId: string,
    actorUserId: string,
    conflictId: string,
    resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED',
    mergedPayload?: DraftSyncBody,
  ): Promise<DraftSyncResult> {
    const conflict = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.syncConflict.findFirst({
        where: { id: conflictId, tenantId, status: 'OPEN' },
      }),
    );
    if (!conflict) throw new NotFoundException('Conflict not found or already resolved');

    const doc = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.document.findFirst({ where: { id: conflict.documentId, tenantId } }),
    );
    if (!doc) throw new NotFoundException('Document not found');

    let result: DraftSyncResult;

    if (resolution === 'KEEP_SERVER') {
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.syncConflict.update({
          where: { id: conflictId },
          data: {
            status: 'RESOLVED',
            resolution: 'KEEP_SERVER',
            resolvedByUserId: actorUserId,
            resolvedAt: new Date(),
          },
        }),
      );
      result = {
        id: doc.id,
        syncRevision: doc.syncRevision,
        clientIdempotencyKey: conflict.clientIdempotencyKey,
        status: doc.status,
      };
    } else {
      const payload =
        resolution === 'MERGED'
          ? mergedPayload
          : (conflict.localSnapshotJson as DraftSyncBody);
      if (!payload?.lines?.length) {
        throw new BadRequestException(
          resolution === 'MERGED'
            ? 'mergedPayload required for MERGED resolution'
            : 'Invalid local snapshot',
        );
      }
      if (resolution === 'MERGED' && !mergedPayload) {
        throw new BadRequestException('mergedPayload required for MERGED resolution');
      }
      const updated = await this.documents.update(
        tenantId,
        actorUserId,
        doc.id,
        { ...payload, version: doc.version },
      );
      const bumped = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        await tx.syncConflict.update({
          where: { id: conflictId },
          data: {
            status: 'RESOLVED',
            resolution,
            resolvedByUserId: actorUserId,
            resolvedAt: new Date(),
          },
        });
        return tx.document.update({
          where: { id: doc.id },
          data: { syncRevision: { increment: 1 } },
          select: { syncRevision: true, status: true },
        });
      });
      result = {
        id: String(updated.id),
        syncRevision: bumped.syncRevision,
        clientIdempotencyKey: conflict.clientIdempotencyKey,
        status: String(updated.status),
      };
    }

    await this.audit.write({
      action: 'sync.conflict.resolve',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'sync_conflict',
      resourceId: conflictId,
      metadata: { resolution, documentId: result.id },
    });
    return result;
  }

  private serverSnapshot(doc: {
    internalId: string;
    kind: string;
    branchId: string;
    currencyCode: string;
    issueDateTime: Date;
    receiverName: string | null;
    receiverId: string | null;
    receiverType: string | null;
    extraDiscountAmount: string;
    lines: Array<Record<string, unknown>>;
  }): Record<string, unknown> {
    return {
      internalId: doc.internalId,
      kind: doc.kind,
      branchId: doc.branchId,
      currencyCode: doc.currencyCode,
      issueDateTime: doc.issueDateTime.toISOString(),
      extraDiscountAmount: doc.extraDiscountAmount,
      receiver: {
        name: doc.receiverName,
        id: doc.receiverId,
        type: doc.receiverType,
      },
      lines: doc.lines.map((l) => ({
        description: l.description,
        itemCode: l.itemCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    };
  }
}
