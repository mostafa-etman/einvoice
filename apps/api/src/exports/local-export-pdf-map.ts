import {
  aggregateTaxTotalsFromLines,
  normalizeLineTaxes,
  parseTaxTotals,
  type LocalInvoicePdfInput,
  type LocalInvoicePdfLocale,
} from '../documents/local-invoice-pdf';
import { issuedEtaLineTaxesRaw } from '../documents/issued-document-import.mapper';
import {
  extractReceivedLineTaxesRaw,
  mapDetailsLines,
} from '../purchases/received-document.mapper';

type JsonObject = Record<string, unknown>;

function asRecord(value: unknown): JsonObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export type IssuedExportPdfRow = {
  kind: string;
  internalId: string;
  issueDateTime: Date;
  currencyCode: string;
  etaPayloadJson: unknown;
  issuerSnapshotJson: unknown;
  receiverName: string | null;
  receiverId?: string | null;
  receiverType?: string | null;
  receiverAddressJson?: unknown;
  totalSalesAmount: string;
  totalDiscountAmount: string;
  extraDiscountAmount: string;
  netAmount: string;
  totalAmount: string;
  taxTotalsJson: unknown;
  lines: Array<{
    lineNumber: number;
    description: string;
    itemType: string;
    itemCode: string;
    unitType: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxes: Array<{
      taxType: string;
      subType: string;
      rate: string;
      amount: string;
    }>;
  }>;
};

export type ReceivedExportPdfRow = {
  kind: string;
  internalId: string | null;
  documentUuid: string;
  dateTimeIssued: Date | null;
  currency: string | null;
  issuerType: string | null;
  issuerId: string | null;
  issuerName: string | null;
  issuerJson: unknown;
  receiverJson: unknown;
  netAmount: string | null;
  totalAmount: string | null;
  rawDetailsJson: unknown;
  lines: Array<Record<string, unknown>>;
};

export function mapIssuedRowToPdfInput(
  row: IssuedExportPdfRow,
  locale: LocalInvoicePdfLocale,
  logo?: LocalInvoicePdfInput['logo'],
): LocalInvoicePdfInput {
  const payload = asRecord(row.etaPayloadJson) ?? {};
  const issuer =
    asRecord(payload.issuer) ?? asRecord(row.issuerSnapshotJson) ?? {};
  const receiver =
    asRecord(payload.receiver) ??
    ({
      type: row.receiverType ?? '',
      id: row.receiverId ?? '',
      name: row.receiverName ?? '',
      address: asRecord(row.receiverAddressJson),
    } satisfies JsonObject);
  const payloadLines = Array.isArray(payload.invoiceLines)
    ? (payload.invoiceLines as JsonObject[])
    : [];

  const lines = row.lines.map((l) => {
    const fromRelation = Array.isArray(l.taxes) ? l.taxes : [];
    const payloadLine =
      payloadLines.find(
        (pl) => Number(pl.lineNumber ?? pl.LineNumber ?? 0) === l.lineNumber,
      ) ?? payloadLines[Math.max(0, l.lineNumber - 1)];
    const taxes =
      fromRelation.length > 0
        ? fromRelation
        : issuedEtaLineTaxesRaw((payloadLine ?? {}) as Record<string, unknown>);
    return {
      description: String(l.description ?? ''),
      itemType: String(l.itemType ?? ''),
      itemCode: String(l.itemCode ?? ''),
      unitType: String(l.unitType ?? ''),
      quantity: String(l.quantity ?? ''),
      unitPrice: String(l.unitPrice ?? ''),
      discountAmount: String(l.discountAmount ?? '0'),
      taxes: normalizeLineTaxes(taxes),
    };
  });

  return {
    locale,
    kind: row.kind,
    internalId: row.internalId,
    issueDateTime: iso(row.issueDateTime),
    currencyCode: row.currencyCode,
    taxpayerActivityCode: String(payload.taxpayerActivityCode ?? ''),
    issuer,
    receiver,
    lines,
    totals: {
      totalSalesAmount: String(row.totalSalesAmount),
      totalDiscountAmount: String(row.totalDiscountAmount),
      extraDiscountAmount: String(row.extraDiscountAmount ?? '0'),
      netAmount: String(row.netAmount),
      totalAmount: String(row.totalAmount),
      taxTotals: row.taxTotalsJson,
    },
    logo,
  };
}

export function mapReceivedRowToPdfInput(
  row: ReceivedExportPdfRow,
  locale: LocalInvoicePdfLocale,
  logo?: LocalInvoicePdfInput['logo'],
): LocalInvoicePdfInput {
  const issuerJson = asRecord(row.issuerJson);
  const receiverJson = asRecord(row.receiverJson);
  const details = asRecord(row.rawDetailsJson);
  const sourceLines: Array<Record<string, unknown>> =
    row.lines.length > 0
      ? row.lines
      : mapDetailsLines(details ?? {}).map((l) => ({
          ...l,
          rawJson: l.rawJson,
          taxesJson: l.taxesJson,
        }));

  const pdfLines = sourceLines.map((line) => {
    const taxes = Array.isArray(line.taxes)
      ? normalizeLineTaxes(line.taxes)
      : normalizeLineTaxes(extractReceivedLineTaxesRaw(line));
    return {
      description: String(line.description ?? ''),
      itemType: String(line.itemType ?? ''),
      itemCode: String(line.itemCode ?? ''),
      unitType: String(line.unitType ?? ''),
      quantity: String(line.quantity ?? ''),
      unitPrice: String(line.unitPrice ?? ''),
      discountAmount: '0',
      taxes,
    };
  });

  let taxTotals = parseTaxTotals(
    details?.taxTotals ?? details?.TaxTotals ?? null,
  );
  if (!taxTotals.length) {
    taxTotals = aggregateTaxTotalsFromLines(pdfLines);
  }

  return {
    locale,
    kind: String(row.kind),
    internalId: String(row.internalId ?? row.documentUuid),
    issueDateTime: iso(row.dateTimeIssued),
    currencyCode: String(row.currency ?? 'EGP'),
    issuer: {
      type: String(row.issuerType ?? issuerJson?.type ?? ''),
      id: String(row.issuerId ?? issuerJson?.id ?? ''),
      name: String(row.issuerName ?? issuerJson?.name ?? ''),
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
        (details?.totalSales as string | undefined) ??
          row.netAmount ??
          row.totalAmount ??
          '0.00',
      ),
      totalDiscountAmount: String(
        (details?.totalDiscount as string | undefined) ?? '0.00',
      ),
      netAmount: String(row.netAmount ?? row.totalAmount ?? '0.00'),
      totalAmount: String(row.totalAmount ?? '0.00'),
      taxTotals,
    },
    logo,
  };
}
