import type { DocumentKind, DocumentStatus, Prisma } from '@prisma/client';
import { KIND_TO_ETA_TYPE } from '@einvoice/eta-core';
import { normalizeLineTaxes } from '../documents/local-invoice-pdf';

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

const ETA_TYPE_TO_KIND: Record<string, DocumentKind> = Object.fromEntries(
  (Object.entries(KIND_TO_ETA_TYPE) as Array<[DocumentKind, string]>).map(
    ([kind, code]) => [code.toUpperCase(), kind],
  ),
) as Record<string, DocumentKind>;

export function etaDocumentTypeToKind(typeCode: string): DocumentKind | null {
  const t = typeCode.trim().toUpperCase();
  if (ETA_TYPE_TO_KIND[t]) return ETA_TYPE_TO_KIND[t]!;
  if (t === 'INVOICE' || t === 'I') return 'INVOICE';
  if (/CREDIT/.test(t) && /EXPORT|E/.test(t)) return 'EXPORT_CREDIT_NOTE';
  if (/DEBIT/.test(t) && /EXPORT|E/.test(t)) return 'EXPORT_DEBIT_NOTE';
  if (/CREDIT/.test(t)) return 'CREDIT_NOTE';
  if (/DEBIT/.test(t)) return 'DEBIT_NOTE';
  if (/EXPORT/.test(t)) return 'EXPORT_INVOICE';
  return null;
}

export const ETA_STATUS_TO_LOCAL: Record<string, DocumentStatus> = {
  valid: 'VALID',
  invalid: 'INVALID',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  submitted: 'SUBMITTED',
};

export type IssuedImportLine = {
  lineNumber: number;
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  discountRate: string;
  currencySold: string;
  amountEgp: string;
  amountSold: string | null;
  currencyExchangeRate: string | null;
  salesTotal: string;
  netTotal: string;
  total: string;
  valueDifference: string;
  totalTaxableFees: string;
  itemsDiscount: string;
  internalCode: string | null;
  taxes: Array<{
    taxType: string;
    subType: string;
    rate: string;
    amount: string;
  }>;
};

export type IssuedImportMapped = {
  etaUuid: string;
  etaLongId: string | null;
  internalId: string;
  kind: DocumentKind;
  etaDocumentType: string;
  etaDocumentTypeVersion: string;
  status: DocumentStatus;
  etaStatus: string | null;
  issueDateTime: Date;
  currencyCode: string;
  issuerSnapshot: Prisma.InputJsonValue;
  receiverType: string | null;
  receiverId: string | null;
  receiverName: string | null;
  receiverAddressJson: Prisma.InputJsonValue | null;
  totalSalesAmount: string;
  totalDiscountAmount: string;
  netAmount: string;
  totalAmount: string;
  extraDiscountAmount: string;
  totalItemsDiscountAmount: string;
  taxTotalsJson: Prisma.InputJsonValue;
  etaPayloadJson: Prisma.InputJsonValue;
  signaturesJson: Prisma.InputJsonValue | null;
  lines: IssuedImportLine[];
};

function money(v: unknown, fallback = '0.00'): string {
  if (v == null || v === '') return fallback;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(2);
}

/** Map ETA Search Sent row + document details into a Document create payload. */
export function mapEtaIssuedDetailsToImport(
  searchRow: Record<string, unknown>,
  details: Record<string, unknown>,
): IssuedImportMapped | null {
  const merged = { ...searchRow, ...details };
  const etaUuid = pickString(
    merged,
    'uuid',
    'UUID',
    'documentUUID',
    'documentUuid',
  );
  if (!etaUuid) return null;

  const typeRaw =
    pickString(
      merged,
      'documentType',
      'DocumentType',
      'type',
      'Type',
      'documentTypeNamePrimaryLang',
    ) || 'I';
  const typeCode = (() => {
    const t = typeRaw.trim();
    if (/^[ICEDi]$/i.test(t)) return t.toUpperCase();
    if (/^EI$/i.test(t) || /^EC$/i.test(t) || /^ED$/i.test(t)) return t.toUpperCase();
    if (/^invoice$/i.test(t)) return 'I';
    if (/credit/i.test(t) && /export/i.test(t)) return 'EC';
    if (/debit/i.test(t) && /export/i.test(t)) return 'ED';
    if (/export/i.test(t)) return 'EI';
    if (/credit/i.test(t)) return 'C';
    if (/debit/i.test(t)) return 'D';
    return t.length <= 3 ? t.toUpperCase() : 'I';
  })();

  const kind = etaDocumentTypeToKind(typeCode);
  if (!kind) return null;

  const issuedRaw = pickString(
    merged,
    'dateTimeIssued',
    'DateTimeIssued',
    'issueDate',
    'IssueDate',
  );
  const issueDateTime = issuedRaw ? new Date(issuedRaw) : new Date();
  if (Number.isNaN(issueDateTime.getTime())) return null;

  const etaStatus = pickString(merged, 'status', 'Status', 'documentStatus') || null;
  const status =
    ETA_STATUS_TO_LOCAL[(etaStatus ?? '').toLowerCase()] ?? 'VALID';

  const issuer =
    pickObj(merged, 'issuer', 'Issuer') ??
    ({ type: 'B', id: '', name: '' } as Record<string, unknown>);
  const receiver = pickObj(merged, 'receiver', 'Receiver');

  const internalId =
    pickString(merged, 'internalId', 'InternalId', 'internalID') ||
    `ETA-${etaUuid.slice(0, 8)}`;

  const linesRaw =
    (Array.isArray(details.invoiceLines) && details.invoiceLines) ||
    (Array.isArray(details.InvoiceLines) && details.InvoiceLines) ||
    (Array.isArray(details.lines) && details.lines) ||
    [];

  const currencyCode =
    pickString(merged, 'currency', 'Currency', 'currencyCode', 'CurrencyCode') ||
    'EGP';

  const lines: IssuedImportLine[] = (linesRaw as Record<string, unknown>[]).map(
    (line, idx) => {
      const unitValue = pickObj(line, 'unitValue', 'UnitValue');
      const unitPrice =
        pickString(unitValue ?? {}, 'amountEGP', 'amountEgp', 'amountSold') ||
        pickString(line, 'unitPrice', 'UnitPrice', 'amountEGP') ||
        '0';
      const taxes = normalizeLineTaxes(
        line.taxableItems ??
          line.TaxableItems ??
          line.taxItems ??
          line.taxes ??
          [],
      ).map((t) => ({
        taxType: t.taxType || 'T1',
        subType: t.subType || '',
        rate: t.rate || '0',
        amount: money(t.amount, '0.00'),
      }));
      const discountObj = pickObj(line, 'discount', 'Discount');
      return {
        lineNumber:
          typeof line.lineNumber === 'number'
            ? line.lineNumber
            : typeof line.LineNumber === 'number'
              ? line.LineNumber
              : idx + 1,
        description:
          pickString(line, 'description', 'Description', 'itemDescription') ||
          '—',
        itemType: pickString(line, 'itemType', 'ItemType') || 'EGS',
        itemCode: pickString(line, 'itemCode', 'ItemCode') || '',
        unitType: pickString(line, 'unitType', 'UnitType') || 'EA',
        quantity: pickString(line, 'quantity', 'Quantity') || '1',
        unitPrice: money(unitPrice),
        discountAmount: money(
          discountObj
            ? discountObj.amount ?? discountObj.Amount
            : line.discountAmount ?? line.DiscountAmount,
        ),
        discountRate: pickString(
          discountObj ?? line,
          'rate',
          'Rate',
          'discountRate',
        ) || '0',
        currencySold:
          pickString(unitValue ?? {}, 'currencySold', 'CurrencySold') ||
          currencyCode,
        amountEgp: money(
          unitValue?.amountEGP ?? unitValue?.amountEgp ?? unitPrice,
        ),
        amountSold: pickString(unitValue ?? {}, 'amountSold', 'AmountSold') || null,
        currencyExchangeRate:
          pickString(
            unitValue ?? {},
            'currencyExchangeRate',
            'CurrencyExchangeRate',
          ) || null,
        salesTotal: money(line.salesTotal ?? line.SalesTotal),
        netTotal: money(line.netTotal ?? line.NetTotal),
        total: money(line.total ?? line.Total),
        valueDifference: money(
          line.valueDifference ?? line.ValueDifference,
          '0.00',
        ),
        totalTaxableFees: money(
          line.totalTaxableFees ?? line.TotalTaxableFees,
          '0.00',
        ),
        itemsDiscount: money(line.itemsDiscount ?? line.ItemsDiscount, '0.00'),
        internalCode: pickString(line, 'internalCode', 'InternalCode') || null,
        taxes,
      };
    },
  );

  const taxTotalsRaw =
    details.taxTotals ?? details.TaxTotals ?? searchRow.taxTotals ?? [];
  let taxTotalsJson: Prisma.InputJsonValue = [];
  if (Array.isArray(taxTotalsRaw)) {
    taxTotalsJson = taxTotalsRaw.map((t) => {
      const row = t as Record<string, unknown>;
      return {
        taxType: pickString(row, 'taxType', 'TaxType', 'type') || 'T1',
        amount: money(row.amount ?? row.Amount),
      };
    }) as Prisma.InputJsonValue;
  }

  const signatures =
    details.signatures ?? details.Signatures ?? null;

  return {
    etaUuid,
    etaLongId: pickString(merged, 'longId', 'LongId', 'longID') || null,
    internalId,
    kind,
    etaDocumentType: typeCode,
    etaDocumentTypeVersion:
      pickString(
        merged,
        'documentTypeVersion',
        'DocumentTypeVersion',
        'typeVersion',
      ) || '1.0',
    status,
    etaStatus,
    issueDateTime,
    currencyCode,
    issuerSnapshot: issuer as Prisma.InputJsonValue,
    receiverType: receiver
      ? pickString(receiver, 'type', 'Type') || null
      : null,
    receiverId: receiver
      ? pickString(receiver, 'id', 'Id', 'registrationNumber') || null
      : null,
    receiverName: receiver ? pickString(receiver, 'name', 'Name') || null : null,
    receiverAddressJson: receiver
      ? ((pickObj(receiver, 'address', 'Address') ??
          null) as Prisma.InputJsonValue | null)
      : null,
    totalSalesAmount: money(
      merged.totalSalesAmount ?? merged.TotalSalesAmount,
    ),
    totalDiscountAmount: money(
      merged.totalDiscountAmount ?? merged.TotalDiscountAmount,
    ),
    netAmount: money(merged.netAmount ?? merged.NetAmount),
    totalAmount: money(
      merged.totalAmount ?? merged.TotalAmount ?? merged.total,
    ),
    extraDiscountAmount: money(
      merged.extraDiscountAmount ?? merged.ExtraDiscountAmount,
    ),
    totalItemsDiscountAmount: money(
      merged.totalItemsDiscountAmount ?? merged.TotalItemsDiscountAmount,
    ),
    taxTotalsJson,
    etaPayloadJson: details as Prisma.InputJsonValue,
    signaturesJson: signatures
      ? (signatures as Prisma.InputJsonValue)
      : null,
    lines,
  };
}
