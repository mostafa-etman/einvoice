import { classifyReceivedDocument } from '@einvoice/eta-core';
import type { Prisma, ReceivedDocumentKind } from '@prisma/client';

function pickString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function pickObj(
  row: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null {
  for (const k of keys) {
    const v = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return null;
}

export type MappedReceivedSummary = {
  documentUuid: string | null;
  etaLongId: string | null;
  internalId: string | null;
  etaDocumentType: string;
  etaDocumentTypeVersion: string | null;
  kind: ReceivedDocumentKind;
  etaStatus: string | null;
  dateTimeIssued: Date | null;
  issuerType: string | null;
  issuerId: string | null;
  issuerName: string | null;
  issuerJson: Prisma.InputJsonValue | null;
  receiverJson: Prisma.InputJsonValue | null;
  currency: string | null;
  totalAmount: string | null;
  netAmount: string | null;
  rawSummaryJson: Prisma.InputJsonValue;
};

export function mapEtaReceivedRow(
  row: Record<string, unknown>,
): MappedReceivedSummary {
  const documentUuid =
    pickString(row, 'uuid', 'UUID', 'documentUUID', 'documentUuid') || null;
  const etaDocumentType =
    pickString(
      row,
      'documentType',
      'DocumentType',
      'type',
      'Type',
      'documentTypeNamePrimaryLang',
    ) || 'UNKNOWN';
  // Prefer single-letter codes when ETA returns names
  const typeCode = (() => {
    const t = etaDocumentType.trim();
    if (/^[ICEDi]$/i.test(t)) return t.toUpperCase();
    if (/^invoice$/i.test(t)) return 'I';
    if (/credit/i.test(t)) return 'C';
    if (/debit/i.test(t)) return 'D';
    return t.length <= 3 ? t.toUpperCase() : t;
  })();

  const issuer = pickObj(row, 'issuer', 'Issuer');
  const receiver = pickObj(row, 'receiver', 'Receiver');
  const issuedRaw = pickString(
    row,
    'dateTimeIssued',
    'DateTimeIssued',
    'issueDate',
    'IssueDate',
  );
  let dateTimeIssued: Date | null = null;
  if (issuedRaw) {
    const d = new Date(issuedRaw);
    if (!Number.isNaN(d.getTime())) dateTimeIssued = d;
  }

  return {
    documentUuid,
    etaLongId: pickString(row, 'longId', 'LongId', 'longID') || null,
    internalId:
      pickString(row, 'internalId', 'InternalId', 'internalID') || null,
    etaDocumentType: typeCode,
    etaDocumentTypeVersion:
      pickString(
        row,
        'documentTypeVersion',
        'DocumentTypeVersion',
        'typeVersion',
      ) || null,
    kind: classifyReceivedDocument(typeCode) as ReceivedDocumentKind,
    etaStatus: pickString(row, 'status', 'Status') || null,
    dateTimeIssued,
    issuerType: issuer
      ? pickString(issuer, 'type', 'Type') || null
      : pickString(row, 'issuerType') || null,
    issuerId: issuer
      ? pickString(issuer, 'id', 'Id', 'registrationNumber') || null
      : pickString(row, 'issuerId') || null,
    issuerName: issuer
      ? pickString(issuer, 'name', 'Name') || null
      : pickString(row, 'issuerName', 'IssuerName') || null,
    issuerJson: issuer ? (issuer as Prisma.InputJsonValue) : null,
    receiverJson: receiver ? (receiver as Prisma.InputJsonValue) : null,
    currency:
      pickString(row, 'currency', 'Currency', 'currencyCode') || null,
    totalAmount:
      pickString(row, 'totalAmount', 'TotalAmount', 'total') || null,
    netAmount: pickString(row, 'netAmount', 'NetAmount') || null,
    rawSummaryJson: row as Prisma.InputJsonValue,
  };
}

export function mapDetailsLines(
  details: Record<string, unknown>,
): Array<{
  lineNumber: number | null;
  description: string | null;
  itemCode: string | null;
  itemType: string | null;
  unitType: string | null;
  quantity: string | null;
  unitPrice: string | null;
  netTotal: string | null;
  total: string | null;
  taxesJson: Prisma.InputJsonValue;
  rawJson: Prisma.InputJsonValue;
}> {
  const linesRaw =
    (Array.isArray(details.invoiceLines) && details.invoiceLines) ||
    (Array.isArray(details.InvoiceLines) && details.InvoiceLines) ||
    (Array.isArray(details.lines) && details.lines) ||
    [];
  return (linesRaw as Record<string, unknown>[]).map((line, idx) => ({
    lineNumber:
      typeof line.lineNumber === 'number'
        ? line.lineNumber
        : typeof line.LineNumber === 'number'
          ? line.LineNumber
          : idx + 1,
    description:
      pickString(line, 'description', 'Description', 'itemDescription') ||
      null,
    itemCode: pickString(line, 'itemCode', 'ItemCode') || null,
    itemType: pickString(line, 'itemType', 'ItemType') || null,
    unitType: pickString(line, 'unitType', 'UnitType') || null,
    quantity: pickString(line, 'quantity', 'Quantity') || null,
    unitPrice:
      pickString(line, 'unitValue', 'UnitValue', 'unitPrice') ||
      (() => {
        const uv = line.unitValue;
        if (uv && typeof uv === 'object') {
          return pickString(uv as Record<string, unknown>, 'amountEGP', 'amountSold');
        }
        return '';
      })() ||
      null,
    netTotal: pickString(line, 'netTotal', 'NetTotal') || null,
    total: pickString(line, 'total', 'Total') || null,
    taxesJson: (() => {
      const fromItems = Array.isArray(line.taxableItems)
        ? line.taxableItems
        : Array.isArray(line.TaxableItems)
          ? line.TaxableItems
          : Array.isArray(line.lineTaxableItems)
            ? line.lineTaxableItems
            : Array.isArray(line.LineTaxableItems)
              ? line.LineTaxableItems
              : null;
      if (fromItems?.length) return fromItems as Prisma.InputJsonValue;
      // Some ETA payloads nest taxes under taxTotals per line or taxItems.
      const alt =
        (Array.isArray(line.taxItems) && line.taxItems) ||
        (Array.isArray(line.TaxItems) && line.TaxItems) ||
        (Array.isArray(line.taxes) && line.taxes) ||
        [];
      return alt as Prisma.InputJsonValue;
    })(),
    rawJson: line as Prisma.InputJsonValue,
  }));
}

/** Prefer non-empty taxesJson, then ETA lineTaxableItems / taxableItems on rawJson. */
export function extractReceivedLineTaxesRaw(
  line: Record<string, unknown>,
): unknown {
  const taxesJson = line.taxesJson;
  if (Array.isArray(taxesJson) && taxesJson.length > 0) return taxesJson;
  if (Array.isArray(line.taxes) && line.taxes.length > 0) return line.taxes;

  const raw =
    line.rawJson && typeof line.rawJson === 'object' && !Array.isArray(line.rawJson)
      ? (line.rawJson as Record<string, unknown>)
      : null;
  if (raw) {
    for (const key of [
      'lineTaxableItems',
      'LineTaxableItems',
      'taxableItems',
      'TaxableItems',
      'taxItems',
      'TaxItems',
      'taxes',
    ]) {
      const v = raw[key];
      if (Array.isArray(v) && v.length > 0) return v;
    }
  }
  return Array.isArray(taxesJson) ? taxesJson : [];
}
