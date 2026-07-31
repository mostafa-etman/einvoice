import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type {
  ReceivedDocBuyerRow,
  ReceivedDocumentBuyerStore,
} from './purchases-buyer-actions.service';
import type { ReceivedBuyerDecision } from './buyer-decision';

@Injectable()
export class PrismaReceivedDocumentBuyerStore
  implements ReceivedDocumentBuyerStore
{
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async findById(
    tenantId: string,
    id: string,
  ): Promise<ReceivedDocBuyerRow | null> {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.findFirst({ where: { id, tenantId } }),
    );
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      documentUuid: row.documentUuid,
      buyerDecision: row.buyerDecision as ReceivedBuyerDecision,
      buyerDecisionReason: row.buyerDecisionReason,
    };
  }

  async saveDecision(
    tenantId: string,
    id: string,
    patch: {
      buyerDecision: ReceivedBuyerDecision;
      buyerDecisionReason: string | null;
      buyerDecisionAt: Date;
      buyerDecisionByUserId: string;
      needsAttention: boolean;
      needsAttentionReason: string | null;
    },
  ): Promise<ReceivedDocBuyerRow> {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.update({
        where: { id },
        data: {
          buyerDecision: patch.buyerDecision,
          buyerDecisionReason: patch.buyerDecisionReason,
          buyerDecisionAt: patch.buyerDecisionAt,
          buyerDecisionByUserId: patch.buyerDecisionByUserId,
          needsAttention: patch.needsAttention,
          needsAttentionReason: patch.needsAttentionReason,
        },
      }),
    );
    return {
      id: row.id,
      tenantId: row.tenantId,
      documentUuid: row.documentUuid,
      buyerDecision: row.buyerDecision as ReceivedBuyerDecision,
      buyerDecisionReason: row.buyerDecisionReason,
    };
  }
}

export type PurchaseListQuery = {
  from?: string;
  to?: string;
  branchId?: string;
  unassignedBranch?: boolean;
  kind?: string;
  buyerDecision?: string;
  reconciliationStatus?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

@Injectable()
export class PurchasesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(tenantId: string, query: PurchaseListQuery) {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const where: Prisma.ReceivedDocumentWhereInput = { tenantId };

    if (query.kind) where.kind = query.kind as never;
    else where.kind = { in: ['PURCHASE_INVOICE', 'PURCHASE_RETURN'] };

    if (query.buyerDecision) where.buyerDecision = query.buyerDecision as never;
    if (query.reconciliationStatus) {
      where.reconciliationStatus = query.reconciliationStatus as never;
    }
    if (query.branchId) where.branchId = query.branchId;
    if (query.unassignedBranch) where.branchId = null;
    if (query.from || query.to) {
      where.dateTimeIssued = {};
      if (query.from) where.dateTimeIssued.gte = new Date(query.from);
      if (query.to) where.dateTimeIssued.lte = new Date(query.to);
    }
    if (query.q) {
      where.OR = [
        { internalId: { contains: query.q, mode: 'insensitive' } },
        { issuerName: { contains: query.q, mode: 'insensitive' } },
        { documentUuid: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.findMany({
        where,
        orderBy: [{ dateTimeIssued: 'desc' }, { createdAt: 'desc' }],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );

    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, take) : rows).map((r) =>
      this.toSummary(r),
    );
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }

  async get(tenantId: string, id: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.findFirst({
        where: { id, tenantId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      }),
    );
    if (!row) return null;
    return {
      ...this.toSummary(row),
      issuerJson: row.issuerJson,
      receiverJson: row.receiverJson,
      lines: row.lines,
      buyerDecisionReason: row.buyerDecisionReason,
      reconciliationNote: row.reconciliationNote,
      purchaseOrderLinkId: row.purchaseOrderLinkId,
      rawDetailsJson: row.rawDetailsJson,
      printoutAvailable: Boolean(row.documentUuid),
      needsAttentionReason: row.needsAttentionReason,
    };
  }

  async patch(
    tenantId: string,
    id: string,
    body: {
      branchId?: string | null;
      reconciliationStatus?: string;
      reconciliationNote?: string | null;
    },
  ) {
    if (body.branchId) {
      const branch = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.branch.findFirst({
          where: { id: body.branchId!, tenantId, isActive: true },
        }),
      );
      if (!branch) {
        throw Object.assign(new Error('Branch not found'), { status: 400 });
      }
    }

    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.update({
        where: { id },
        data: {
          ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
          ...(body.reconciliationStatus
            ? { reconciliationStatus: body.reconciliationStatus as never }
            : {}),
          ...(body.reconciliationNote !== undefined
            ? { reconciliationNote: body.reconciliationNote }
            : {}),
        },
        include: { lines: true },
      }),
    );
    return this.get(tenantId, row.id);
  }

  private toSummary(r: {
    id: string;
    documentUuid: string;
    etaLongId: string | null;
    internalId: string | null;
    kind: string;
    etaDocumentType: string;
    etaStatus: string | null;
    dateTimeIssued: Date | null;
    issuerName: string | null;
    totalAmount: string | null;
    currency: string | null;
    buyerDecision: string;
    reconciliationStatus: string;
    branchId: string | null;
    needsAttention: boolean;
    lastSyncedAt: Date;
  }) {
    return {
      id: r.id,
      documentUuid: r.documentUuid,
      etaLongId: r.etaLongId,
      internalId: r.internalId,
      kind: r.kind,
      etaDocumentType: r.etaDocumentType,
      etaStatus: r.etaStatus,
      dateTimeIssued: r.dateTimeIssued?.toISOString() ?? null,
      issuerName: r.issuerName,
      totalAmount: r.totalAmount,
      currency: r.currency,
      buyerDecision: r.buyerDecision,
      reconciliationStatus: r.reconciliationStatus,
      branchId: r.branchId,
      needsAttention: r.needsAttention,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
    };
  }
}
