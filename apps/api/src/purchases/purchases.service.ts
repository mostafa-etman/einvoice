import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { ArtifactStorage } from '../storage/storage.module';
import {
  aggregateTaxTotalsFromLines,
  normalizeLineTaxes,
  parseTaxTotals,
  renderLocalInvoicePdf,
  type LocalInvoicePdfLocale,
} from '../documents/local-invoice-pdf';
import { extractReceivedLineTaxesRaw, mapDetailsLines } from './received-document.mapper';
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
  etaStatus?: string;
  /** Filter issuer/seller name (AND with free-text q). */
  seller?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  sortBy?: 'dateTimeIssued' | 'totalAmount' | 'internalId' | 'issuerName' | 'lastSyncedAt';
  sortDir?: 'asc' | 'desc';
};

function parseOptionalDate(value?: string): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
  ) {}

  async list(tenantId: string, query: PurchaseListQuery) {
    const take = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const where: Prisma.ReceivedDocumentWhereInput = { tenantId };

    if (query.kind) where.kind = query.kind as never;
    else where.kind = { in: ['PURCHASE_INVOICE', 'PURCHASE_RETURN'] };

    if (query.buyerDecision) where.buyerDecision = query.buyerDecision as never;
    if (query.reconciliationStatus) {
      where.reconciliationStatus = query.reconciliationStatus as never;
    }
    if (query.etaStatus) {
      where.etaStatus = { equals: query.etaStatus, mode: 'insensitive' };
    }
    if (query.seller?.trim()) {
      where.issuerName = {
        contains: query.seller.trim(),
        mode: 'insensitive',
      };
    }
    if (query.branchId) where.branchId = query.branchId;
    if (query.unassignedBranch) where.branchId = null;
    const fromDate = parseOptionalDate(query.from);
    const toDate = parseOptionalDate(query.to);
    if (fromDate || toDate) {
      where.dateTimeIssued = {};
      if (fromDate) where.dateTimeIssued.gte = fromDate;
      if (toDate) where.dateTimeIssued.lte = toDate;
    }
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { internalId: { contains: q, mode: 'insensitive' } },
        { issuerName: { contains: q, mode: 'insensitive' } },
        { issuerId: { contains: q, mode: 'insensitive' } },
        { documentUuid: { contains: q, mode: 'insensitive' } },
        { etaLongId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const allowedSort = new Set([
      'dateTimeIssued',
      'totalAmount',
      'internalId',
      'issuerName',
      'lastSyncedAt',
    ] as const);
    const sortBy = allowedSort.has(query.sortBy as never)
      ? (query.sortBy as
          | 'dateTimeIssued'
          | 'totalAmount'
          | 'internalId'
          | 'issuerName'
          | 'lastSyncedAt')
      : 'dateTimeIssued';
    const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.ReceivedDocumentOrderByWithRelationInput[] = [
      { [sortBy]: sortDir },
      { id: 'desc' },
    ];

    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.receivedDocument.findMany({
        where,
        orderBy,
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

    const details = asRecord(row.rawDetailsJson);
    const sourceLines: Array<Record<string, unknown>> =
      row.lines.length > 0
        ? (row.lines as unknown as Array<Record<string, unknown>>)
        : hydrateLinesFromDetails(details);

    const lines = sourceLines.map((line) => {
      const taxes = normalizeLineTaxes(extractReceivedLineTaxesRaw(line));
      return {
        id: line.id,
        lineNumber: line.lineNumber ?? null,
        description: line.description ?? null,
        itemCode: line.itemCode ?? null,
        itemType: line.itemType ?? null,
        unitType: line.unitType ?? null,
        quantity: line.quantity ?? null,
        unitPrice: line.unitPrice ?? null,
        netTotal: line.netTotal ?? null,
        total: line.total ?? null,
        rawJson: line.rawJson ?? null,
        taxes,
        taxesJson: taxes.length ? taxes : line.taxesJson ?? [],
      };
    });

    let taxTotals = parseTaxTotals(
      details?.taxTotals ?? details?.TaxTotals ?? null,
    );
    if (!taxTotals.length) {
      taxTotals = aggregateTaxTotalsFromLines(
        lines.map((l) => ({
          description: String(l.description ?? ''),
          itemType: String(l.itemType ?? ''),
          itemCode: String(l.itemCode ?? ''),
          unitType: String(l.unitType ?? ''),
          quantity: String(l.quantity ?? ''),
          unitPrice: String(l.unitPrice ?? ''),
          taxes: l.taxes,
        })),
      );
    }

    return {
      ...this.toSummary(row),
      issuerType: row.issuerType,
      issuerId: row.issuerId,
      netAmount: row.netAmount,
      issuerJson: row.issuerJson,
      receiverJson: row.receiverJson,
      lines,
      taxTotals,
      buyerDecisionReason: row.buyerDecisionReason,
      reconciliationNote: row.reconciliationNote,
      purchaseOrderLinkId: row.purchaseOrderLinkId,
      rawDetailsJson: row.rawDetailsJson,
      printoutAvailable: Boolean(row.documentUuid),
      needsAttentionReason: row.needsAttentionReason,
    };
  }

  /** Local printable PDF (display-only). Distinct from ETA official printout. */
  async localPrintout(
    tenantId: string,
    id: string,
    locale?: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const detail = await this.get(tenantId, id);
    if (!detail) {
      throw Object.assign(new Error('Purchase not found'), { status: 404 });
    }

    const issuerJson = asRecord(detail.issuerJson);
    const receiverJson = asRecord(detail.receiverJson);
    const lines = Array.isArray(detail.lines) ? detail.lines : [];
    const logo = await this.loadTenantLogo(tenantId);

    const pdfLines = lines.map((line) => {
      const l = line as Record<string, unknown>;
      const taxes = Array.isArray(l.taxes)
        ? normalizeLineTaxes(l.taxes)
        : normalizeLineTaxes(extractReceivedLineTaxesRaw(l));
      return {
        description: String(l.description ?? ''),
        itemType: String(l.itemType ?? ''),
        itemCode: String(l.itemCode ?? ''),
        unitType: String(l.unitType ?? ''),
        quantity: String(l.quantity ?? ''),
        unitPrice: String(l.unitPrice ?? ''),
        discountAmount: '0',
        taxes,
      };
    });
    const taxTotals =
      Array.isArray(detail.taxTotals) && detail.taxTotals.length
        ? detail.taxTotals
        : aggregateTaxTotalsFromLines(pdfLines);

    const pdf = await renderLocalInvoicePdf({
      locale: locale?.toLowerCase().startsWith('ar') ? 'ar' : ('en' as LocalInvoicePdfLocale),
      kind: String(detail.kind),
      internalId: String(detail.internalId ?? detail.documentUuid),
      issueDateTime: String(detail.dateTimeIssued ?? ''),
      currencyCode: String(detail.currency ?? 'EGP'),
      issuer: {
        type: String(detail.issuerType ?? issuerJson?.type ?? ''),
        id: String(detail.issuerId ?? issuerJson?.id ?? ''),
        name: String(detail.issuerName ?? issuerJson?.name ?? ''),
        address: asRecord(issuerJson?.address) ?? null,
      },
      receiver: receiverJson
        ? {
            type: String(receiverJson.type ?? ''),
            id: String(receiverJson.id ?? ''),
            name: String(receiverJson.name ?? ''),
            address: asRecord(receiverJson.address) ?? null,
          }
        : null,
      lines: pdfLines,
      totals: {
        totalSalesAmount: String(
          (asRecord(detail.rawDetailsJson)?.totalSales as string | undefined) ??
            detail.netAmount ??
            detail.totalAmount ??
            '0.00',
        ),
        totalDiscountAmount: String(
          (asRecord(detail.rawDetailsJson)?.totalDiscount as string | undefined) ??
            '0.00',
        ),
        netAmount: String(detail.netAmount ?? detail.totalAmount ?? '0.00'),
        totalAmount: String(detail.totalAmount ?? '0.00'),
        taxTotals,
      },
      logo,
    });

    return {
      pdf,
      filename: `purchase-${detail.documentUuid}-preview.pdf`,
    };
  }

  private async loadTenantLogo(
    tenantId: string,
  ): Promise<{ buffer: Buffer; contentType?: string } | null> {
    const tenant = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { logoObjectKey: true, logoContentType: true },
      }),
    );
    if (!tenant?.logoObjectKey) return null;
    try {
      const buffer = await this.artifacts.getByKey(tenant.logoObjectKey);
      return { buffer, contentType: tenant.logoContentType ?? undefined };
    } catch {
      return null;
    }
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
    issuerId?: string | null;
    issuerType?: string | null;
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
      issuerId: r.issuerId ?? null,
      issuerType: r.issuerType ?? null,
      totalAmount: r.totalAmount,
      currency: r.currency,
      buyerDecision: r.buyerDecision,
      reconciliationStatus: r.reconciliationStatus,
      branchId: r.branchId,
      needsAttention: r.needsAttention,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      synced: true,
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function hydrateLinesFromDetails(
  details: Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  if (!details) return [];
  return mapDetailsLines(details).map((l) => ({
    ...l,
    rawJson: l.rawJson,
    taxesJson: l.taxesJson,
  }));
}
