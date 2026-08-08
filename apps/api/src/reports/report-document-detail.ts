/**
 * Invoice-by-invoice Sales Detail (S5) and Purchases Detail (P5) builders.
 */

import type { Prisma } from '@prisma/client';
import {
  extractIssuedDocumentTaxes,
  extractReceivedDocumentTaxes,
} from './report-tax-sources';
import {
  attachTaxNames,
  loadItemNamesByCode,
  loadTaxCatalogNames,
} from './report-catalog-labels';
import {
  normalizeLineTaxes,
} from '../documents/local-invoice-pdf';
import { extractReceivedLineTaxesRaw } from '../purchases/received-document.mapper';
import type { ReportFilters } from './report-filters';

type Tx = Prisma.TransactionClient;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function ymd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function taxSummaryLabel(
  taxes: Array<{
    taxType: string;
    taxTypeNameEn?: string | null;
    taxTypeNameAr?: string | null;
    subType?: string;
    subTypeNameEn?: string | null;
    subTypeNameAr?: string | null;
    rate: string;
    amount: string;
  }>,
): { taxesSummaryEn: string; taxesSummaryAr: string } {
  const enParts: string[] = [];
  const arParts: string[] = [];
  for (const t of taxes) {
    const nameEn = t.taxTypeNameEn || t.taxType;
    const nameAr = t.taxTypeNameAr || t.taxTypeNameEn || t.taxType;
    const subEn = t.subType
      ? `/${t.subTypeNameEn || t.subType}`
      : '';
    const subAr = t.subType
      ? `/${t.subTypeNameAr || t.subTypeNameEn || t.subType}`
      : '';
    enParts.push(`${nameEn}${subEn} ${t.rate}%: ${t.amount}`);
    arParts.push(`${nameAr}${subAr} ${t.rate}%: ${t.amount}`);
  }
  return {
    taxesSummaryEn: enParts.join(' · ') || '—',
    taxesSummaryAr: arParts.join(' · ') || '—',
  };
}

export async function buildSalesDetail(tx: Tx, f: ReportFilters) {
  const where: Prisma.DocumentWhereInput = {
    issueDateTime: { gte: f.rangeStart, lte: f.rangeEnd },
  };
  if (f.branchId) where.branchId = f.branchId;
  if (f.currencyCode) where.currencyCode = f.currencyCode;
  if (f.documentKinds?.length) {
    where.kind = { in: f.documentKinds as never };
  }
  if (f.status) {
    where.status = f.status as never;
  } else if (!f.includeNonFinancialStatuses) {
    // Detail reports show all statuses by default when includeOthers is on;
    // default still VALID-focused unless includeNonFinancialStatuses.
    where.status = 'VALID' as never;
  }
  if (f.counterparty?.trim()) {
    const c = f.counterparty.trim();
    where.OR = [
      { receiverName: { contains: c, mode: 'insensitive' } },
      { receiverId: { contains: c, mode: 'insensitive' } },
    ];
  }
  if (f.q?.trim()) {
    const q = f.q.trim();
    const searchOr: Prisma.DocumentWhereInput[] = [
      { internalId: { contains: q, mode: 'insensitive' } },
      { receiverName: { contains: q, mode: 'insensitive' } },
      { receiverId: { contains: q, mode: 'insensitive' } },
      { etaUuid: { contains: q, mode: 'insensitive' } },
      { etaLongId: { contains: q, mode: 'insensitive' } },
    ];
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: searchOr }];
  }

  const sortBy = f.sortBy ?? 'issueDateTime';
  const sortDir = f.sortDir === 'asc' ? 'asc' : 'desc';
  const allowed = new Set([
    'issueDateTime',
    'totalAmount',
    'internalId',
    'receiverName',
    'status',
  ]);
  const orderField = allowed.has(sortBy) ? sortBy : 'issueDateTime';
  const take = Math.min(Math.max(f.limit || 50, 1), 2000);
  const skip = Math.max(f.offset ?? 0, 0);

  const [totalCount, docs] = await Promise.all([
    tx.document.count({ where }),
    tx.document.findMany({
      where,
      orderBy: [{ [orderField]: sortDir }, { id: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        kind: true,
        status: true,
        origin: true,
        internalId: true,
        etaUuid: true,
        etaLongId: true,
        issueDateTime: true,
        currencyCode: true,
        receiverType: true,
        receiverId: true,
        receiverName: true,
        receiverAddressJson: true,
        issuerSnapshotJson: true,
        totalSalesAmount: true,
        totalDiscountAmount: true,
        netAmount: true,
        totalAmount: true,
        taxTotalsJson: true,
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: {
            lineNumber: true,
            description: true,
            itemType: true,
            itemCode: true,
            unitType: true,
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            netTotal: true,
            total: true,
            taxes: {
              select: {
                taxType: true,
                subType: true,
                rate: true,
                amount: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const catalogs = await loadTaxCatalogNames(tx);
  const itemNames = await loadItemNamesByCode(
    tx,
    docs.flatMap((d) => d.lines.map((l) => l.itemCode)).filter(Boolean),
  );

  const rows = docs.map((d) => {
    const issuer = asRecord(d.issuerSnapshotJson);
    const docTaxes = attachTaxNames(
      extractIssuedDocumentTaxes({
        taxTotalsJson: d.taxTotalsJson,
        lines: d.lines,
      }).map((t) => ({
        taxType: t.taxType,
        subType: t.subType,
        rate: t.rate,
        amount: t.amount,
      })),
      catalogs,
    );
    const taxLabel = taxSummaryLabel(docTaxes);
    const lines = d.lines.map((line) => {
      const lineTaxes = attachTaxNames(
        (line.taxes ?? []).map((t) => ({
          taxType: t.taxType,
          subType: t.subType,
          rate: t.rate,
          amount: t.amount,
        })),
        catalogs,
      );
      return {
        lineNumber: line.lineNumber,
        itemName: itemNames.get(line.itemCode) ?? null,
        itemCode: line.itemCode,
        itemType: line.itemType,
        description: line.description,
        quantity: line.quantity,
        unitType: line.unitType,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        netTotal: line.netTotal,
        total: line.total,
        taxes: lineTaxes,
      };
    });

    return {
      id: d.id,
      internalId: d.internalId,
      etaUuid: d.etaUuid,
      etaLongId: d.etaLongId,
      kind: d.kind,
      origin: d.origin,
      issueDate: ymd(d.issueDateTime),
      issueDateTime: d.issueDateTime.toISOString(),
      receiverName: d.receiverName,
      receiverId: d.receiverId,
      receiverType: d.receiverType,
      issuerName: issuer?.name != null ? String(issuer.name) : null,
      issuerId: issuer?.id != null ? String(issuer.id) : null,
      netAmount: d.netAmount,
      totalDiscountAmount: d.totalDiscountAmount,
      totalSalesAmount: d.totalSalesAmount,
      totalAmount: d.totalAmount,
      currencyCode: d.currencyCode,
      status: d.status,
      taxes: docTaxes,
      taxesSummaryEn: taxLabel.taxesSummaryEn,
      taxesSummaryAr: taxLabel.taxesSummaryAr,
      lines,
    };
  });

  return {
    reportId: 'S5' as const,
    filters: {
      from: f.from,
      to: f.to,
      status: f.status ?? null,
      counterparty: f.counterparty ?? null,
      q: f.q ?? null,
      documentKinds: f.documentKinds ?? null,
      sortBy: orderField,
      sortDir,
      limit: take,
      offset: skip,
      includeNonFinancialStatuses: f.includeNonFinancialStatuses,
    },
    summary: {
      documentCount: totalCount,
      pageCount: rows.length,
      offset: skip,
      limit: take,
      hasMore: skip + rows.length < totalCount,
    },
    rows,
    nextOffset: skip + rows.length < totalCount ? skip + rows.length : null,
  };
}

export async function buildPurchasesDetail(tx: Tx, f: ReportFilters) {
  const where: Prisma.ReceivedDocumentWhereInput = {
    dateTimeIssued: { gte: f.rangeStart, lte: f.rangeEnd },
    kind: f.documentKinds?.length
      ? { in: f.documentKinds as never }
      : { in: ['PURCHASE_INVOICE', 'PURCHASE_RETURN', 'OTHER_RECEIVED'] },
  };
  if (f.branchId) where.branchId = f.branchId;
  if (f.currencyCode) where.currency = f.currencyCode;
  if (f.status) {
    where.etaStatus = { equals: f.status, mode: 'insensitive' };
  } else if (!f.includeNonFinancialStatuses) {
    where.etaStatus = { equals: 'Valid', mode: 'insensitive' };
  }
  if (f.counterparty?.trim()) {
    const c = f.counterparty.trim();
    where.OR = [
      { issuerName: { contains: c, mode: 'insensitive' } },
      { issuerId: { contains: c, mode: 'insensitive' } },
    ];
  }
  if (f.q?.trim()) {
    const q = f.q.trim();
    const searchOr: Prisma.ReceivedDocumentWhereInput[] = [
      { internalId: { contains: q, mode: 'insensitive' } },
      { issuerName: { contains: q, mode: 'insensitive' } },
      { issuerId: { contains: q, mode: 'insensitive' } },
      { documentUuid: { contains: q, mode: 'insensitive' } },
      { etaLongId: { contains: q, mode: 'insensitive' } },
    ];
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { OR: searchOr },
    ];
  }

  const sortBy = f.sortBy ?? 'dateTimeIssued';
  const sortDir = f.sortDir === 'asc' ? 'asc' : 'desc';
  const allowed = new Set([
    'dateTimeIssued',
    'totalAmount',
    'internalId',
    'issuerName',
    'etaStatus',
  ]);
  const orderField = allowed.has(sortBy) ? sortBy : 'dateTimeIssued';
  const take = Math.min(Math.max(f.limit || 50, 1), 2000);
  const skip = Math.max(f.offset ?? 0, 0);

  const [totalCount, docs] = await Promise.all([
    tx.receivedDocument.count({ where }),
    tx.receivedDocument.findMany({
      where,
      orderBy: [{ [orderField]: sortDir }, { id: 'desc' }],
      skip,
      take,
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    }),
  ]);

  const catalogs = await loadTaxCatalogNames(tx);
  const itemNames = await loadItemNamesByCode(
    tx,
    docs
      .flatMap((d) => d.lines.map((l) => l.itemCode).filter(Boolean) as string[])
      .filter(Boolean),
  );

  const rows = docs.map((d) => {
    const docTaxes = attachTaxNames(
      extractReceivedDocumentTaxes({
        rawSummaryJson: d.rawSummaryJson,
        rawDetailsJson: d.rawDetailsJson,
        lines: d.lines,
      }).map((t) => ({
        taxType: t.taxType,
        subType: t.subType,
        rate: t.rate,
        amount: t.amount,
      })),
      catalogs,
    );
    const taxLabel = taxSummaryLabel(docTaxes);
    const details = asRecord(d.rawDetailsJson);
    const discount =
      details?.totalDiscount != null
        ? String(details.totalDiscount)
        : details?.totalDiscountAmount != null
          ? String(details.totalDiscountAmount)
          : null;

    const lines = d.lines.map((line) => {
      const rawTaxes = extractReceivedLineTaxesRaw(
        line as unknown as Record<string, unknown>,
      );
      const normalized = normalizeLineTaxes(rawTaxes);
      const lineTaxes = attachTaxNames(
        normalized.map((t) => ({
          taxType: t.taxType,
          subType: t.subType,
          rate: t.rate,
          amount: t.amount ?? '0',
        })),
        catalogs,
      );
      const code = line.itemCode ?? '';
      return {
        lineNumber: line.lineNumber,
        itemName: code ? itemNames.get(code) ?? null : null,
        itemCode: line.itemCode,
        itemType: line.itemType,
        description: line.description,
        quantity: line.quantity,
        unitType: line.unitType,
        unitPrice: line.unitPrice,
        discountAmount: null as string | null,
        netTotal: line.netTotal,
        total: line.total,
        taxes: lineTaxes,
      };
    });

    return {
      id: d.id,
      internalId: d.internalId,
      etaUuid: d.documentUuid,
      etaLongId: d.etaLongId,
      kind: d.kind,
      etaDocumentType: d.etaDocumentType,
      issueDate: ymd(d.dateTimeIssued),
      issueDateTime: d.dateTimeIssued?.toISOString() ?? null,
      issuerName: d.issuerName,
      issuerId: d.issuerId,
      issuerType: d.issuerType,
      netAmount: d.netAmount,
      totalDiscountAmount: discount,
      totalAmount: d.totalAmount,
      currencyCode: d.currency,
      status: d.etaStatus,
      buyerDecision: d.buyerDecision,
      taxes: docTaxes,
      taxesSummaryEn: taxLabel.taxesSummaryEn,
      taxesSummaryAr: taxLabel.taxesSummaryAr,
      lines,
    };
  });

  return {
    reportId: 'P5' as const,
    filters: {
      from: f.from,
      to: f.to,
      status: f.status ?? null,
      counterparty: f.counterparty ?? null,
      q: f.q ?? null,
      documentKinds: f.documentKinds ?? null,
      sortBy: orderField,
      sortDir,
      limit: take,
      offset: skip,
      includeNonFinancialStatuses: f.includeNonFinancialStatuses,
    },
    summary: {
      documentCount: totalCount,
      pageCount: rows.length,
      offset: skip,
      limit: take,
      hasMore: skip + rows.length < totalCount,
    },
    rows,
    nextOffset: skip + rows.length < totalCount ? skip + rows.length : null,
  };
}

/** Flatten detail rows + lines for spreadsheet export. */
export function flattenDetailForExport(
  rows: Array<Record<string, unknown>>,
  side: 'sales' | 'purchases',
): {
  documents: Array<Record<string, unknown>>;
  lines: Array<Record<string, unknown>>;
} {
  const documents: Array<Record<string, unknown>> = [];
  const linesOut: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const { lines, taxes, ...doc } = row;
    documents.push({
      ...doc,
      taxesSummary: doc.taxesSummaryEn ?? doc.taxesSummaryAr,
      partyName: side === 'sales' ? doc.receiverName : doc.issuerName,
      partyTaxId: side === 'sales' ? doc.receiverId : doc.issuerId,
    });
    if (!Array.isArray(lines)) continue;
    for (const line of lines as Array<Record<string, unknown>>) {
      const lineTaxes = Array.isArray(line.taxes) ? line.taxes : [];
      const taxStr = (lineTaxes as Array<Record<string, unknown>>)
        .map(
          (t) =>
            `${t.taxTypeNameEn || t.taxType}${t.subType ? '/' + t.subType : ''} ${t.rate}%: ${t.amount}`,
        )
        .join(' · ');
      linesOut.push({
        documentId: doc.id,
        internalId: doc.internalId,
        etaUuid: doc.etaUuid,
        lineNumber: line.lineNumber,
        itemName: line.itemName,
        itemCode: line.itemCode,
        itemType: line.itemType,
        description: line.description,
        quantity: line.quantity,
        unitType: line.unitType,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        netTotal: line.netTotal,
        total: line.total,
        taxes: taxStr,
      });
    }
  }
  return { documents, lines: linesOut };
}
