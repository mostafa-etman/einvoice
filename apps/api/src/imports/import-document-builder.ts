import { isFixedAmountTaxType } from '@einvoice/eta-core';
import type { DocumentKind } from '@prisma/client';
import type { DocumentUpsertDto } from '../documents/documents.service';
import {
  DOC_TYPE_TO_KIND,
  IMPORT_TAX_SLOTS,
} from './import-schema';
import { normalizeMappedImportValues } from './import-value-aliases';
import {
  invalidImportDateMessage,
  normalizeImportDate,
} from './import-excel-date';

export type MappedImportRow = {
  rowNumber: number;
  mapped: Record<string, string>;
};

export type InvoiceGroup = {
  internalId: string;
  rows: MappedImportRow[];
};

export type BuildContext = {
  /** Fallback branch UUID when branchCode is blank / unresolved. */
  defaultBranchId: string;
  /** Resolve branch ETA code → UUID; return null if unknown. */
  resolveBranchId?: (branchCode: string) => string | null | undefined;
  /** Job-level document type letter (I/C/D/…). */
  jobDocumentType: string;
};

function cell(mapped: Record<string, string>, key: string): string {
  return (mapped[key] ?? '').trim();
}

function firstNonEmpty(
  rows: MappedImportRow[],
  key: string,
): string {
  for (const r of rows) {
    const v = cell(r.mapped, key);
    if (v) return v;
  }
  return '';
}

function parseReferences(raw: string): string[] | null {
  if (!raw.trim()) return null;
  const refs = raw
    .split(/[|;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return refs.length ? refs : null;
}

export function resolveDocumentKind(
  rowType: string | undefined,
  jobDocumentType: string,
): DocumentKind {
  const normalized = normalizeMappedImportValues({
    documentType: rowType || jobDocumentType || 'I',
  }).documentType;
  const code = (normalized || 'I').trim().toUpperCase();
  const kind = DOC_TYPE_TO_KIND[code];
  return (kind as DocumentKind) ?? 'INVOICE';
}

export function groupRowsByInternalId(
  rows: MappedImportRow[],
): InvoiceGroup[] {
  const order: string[] = [];
  const map = new Map<string, MappedImportRow[]>();
  for (const row of rows) {
    const key = cell(row.mapped, 'internalID');
    if (!key) continue;
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(row);
  }
  return order.map((internalId) => ({
    internalId,
    rows: map.get(internalId)!,
  }));
}

function buildTaxes(
  mapped: Record<string, string>,
): NonNullable<DocumentUpsertDto['lines'][number]['taxes']> {
  const taxes: NonNullable<DocumentUpsertDto['lines'][number]['taxes']> = [];
  for (let n = 1; n <= IMPORT_TAX_SLOTS; n++) {
    const taxType = cell(mapped, `taxType${n}`);
    if (!taxType) continue;
    const subType = cell(mapped, `taxSubType${n}`);
    const rate = cell(mapped, `taxRate${n}`) || '0';
    const amount = cell(mapped, `taxAmount${n}`);
    const fixed = isFixedAmountTaxType(taxType);
    taxes.push({
      taxType,
      subType,
      rate: fixed ? '0' : rate,
      ...(fixed ? { amount: amount || '0.00' } : {}),
    });
  }
  return taxes;
}

function buildLine(
  mapped: Record<string, string>,
  currencyCode: string,
): DocumentUpsertDto['lines'][number] {
  const unitPrice = cell(mapped, 'unitPrice') || '0.00';
  const amountSold = cell(mapped, 'amountSold');
  const fx = cell(mapped, 'currencyExchangeRate');
  return {
    description: cell(mapped, 'description') || cell(mapped, 'itemCode') || 'Item',
    itemType: cell(mapped, 'itemType') || 'EGS',
    itemCode: cell(mapped, 'itemCode'),
    unitType: cell(mapped, 'unitType') || 'EA',
    quantity: cell(mapped, 'quantity') || '1',
    unitPrice,
    discountAmount: cell(mapped, 'discountAmount') || '0.00',
    discountRate: cell(mapped, 'discountRate') || '0',
    currencySold: currencyCode,
    amountEGP: unitPrice,
    ...(amountSold ? { amountSold } : {}),
    ...(fx ? { currencyExchangeRate: fx } : {}),
    ...(cell(mapped, 'internalCode')
      ? { internalCode: cell(mapped, 'internalCode') }
      : {}),
    ...(cell(mapped, 'weightUnitType')
      ? { weightUnitType: cell(mapped, 'weightUnitType') }
      : {}),
    ...(cell(mapped, 'weightQuantity')
      ? { weightQuantity: cell(mapped, 'weightQuantity') }
      : {}),
    taxes: buildTaxes(mapped),
  };
}

function requiredIsoDate(
  raw: string,
  rowNumber: number,
  columnLabel: string,
): string {
  const parsed = normalizeImportDate(raw);
  if (parsed.status === 'ok') return parsed.iso;
  const original =
    parsed.status === 'invalid' ? parsed.original : raw || '(empty)';
  throw new Error(invalidImportDateMessage(rowNumber, columnLabel, original));
}

function optionalDate(
  raw: string,
  rowNumber: number,
  columnLabel: string,
  kind: 'iso' | 'ymd',
): string | undefined {
  const parsed = normalizeImportDate(raw);
  if (parsed.status === 'empty') return undefined;
  if (parsed.status !== 'ok') {
    throw new Error(
      invalidImportDateMessage(rowNumber, columnLabel, parsed.original),
    );
  }
  return kind === 'ymd' ? parsed.ymd : parsed.iso;
}

function buildPayment(
  head: Record<string, string>,
): DocumentUpsertDto['payment'] {
  const payment = {
    bankName: cell(head, 'paymentBankName') || undefined,
    bankAddress: cell(head, 'paymentBankAddress') || undefined,
    bankAccountNo: cell(head, 'paymentBankAccountNo') || undefined,
    bankAccountIBAN: cell(head, 'paymentBankAccountIBAN') || undefined,
    swiftCode: cell(head, 'paymentSwiftCode') || undefined,
    terms: cell(head, 'paymentTerms') || undefined,
  };
  const any = Object.values(payment).some((v) => Boolean(v));
  return any ? payment : null;
}

function buildDelivery(
  head: Record<string, string>,
  dateValidity: string | undefined,
): DocumentUpsertDto['delivery'] {
  const delivery = {
    approach: cell(head, 'deliveryApproach') || undefined,
    packaging: cell(head, 'deliveryPackaging') || undefined,
    dateValidity: dateValidity || undefined,
    exportPort: cell(head, 'deliveryExportPort') || undefined,
    countryOfOrigin: cell(head, 'deliveryCountryOfOrigin') || undefined,
    grossWeight: cell(head, 'deliveryGrossWeight') || undefined,
    netWeight: cell(head, 'deliveryNetWeight') || undefined,
    terms: cell(head, 'deliveryTerms') || undefined,
  };
  const any = Object.values(delivery).some((v) => Boolean(v));
  return any ? delivery : null;
}

/**
 * Build a DocumentUpsertDto identical in shape to the invoice screen body().
 * Issuer is omitted so DocumentsService.resolveBinding fills it from settings.
 */
export function buildDocumentUpsert(
  group: InvoiceGroup,
  ctx: BuildContext,
): DocumentUpsertDto {
  const rows = group.rows.map((r) => ({
    ...r,
    mapped: normalizeMappedImportValues(r.mapped),
  }));
  const head = rows[0]!.mapped;
  const kind = resolveDocumentKind(
    firstNonEmpty(rows, 'documentType'),
    ctx.jobDocumentType,
  );
  const currencyCode =
    firstNonEmpty(rows, 'currencyCode') || 'EGP';
  const branchCode = firstNonEmpty(rows, 'branchCode');
  const resolvedBranch =
    (branchCode && ctx.resolveBranchId?.(branchCode)) || undefined;
  const branchId = resolvedBranch || ctx.defaultBranchId;

  const activity = firstNonEmpty(rows, 'taxpayerActivityCode');
  const firstRow = group.rows[0]!.rowNumber;
  const issueDateTime = requiredIsoDate(
    firstNonEmpty(rows, 'dateTimeIssued'),
    firstRow,
    'تاريخ الإصدار',
  );
  const serviceDeliveryDate = optionalDate(
    firstNonEmpty(rows, 'serviceDeliveryDate'),
    firstRow,
    'تاريخ تسليم الخدمة',
    'ymd',
  );
  const deliveryDateValidity = optionalDate(
    cell(head, 'deliveryDateValidity'),
    firstRow,
    'صلاحية التسليم',
    'iso',
  );

  return {
    kind,
    branchId,
    currencyCode,
    issueDateTime,
    internalId: group.internalId,
    version: 0,
    ...(activity ? { taxpayerActivityCode: activity } : {}),
    purchaseOrderReference:
      firstNonEmpty(rows, 'purchaseOrderReference') || undefined,
    purchaseOrderDescription:
      firstNonEmpty(rows, 'purchaseOrderDescription') || undefined,
    salesOrderReference:
      firstNonEmpty(rows, 'salesOrderReference') || undefined,
    salesOrderDescription:
      firstNonEmpty(rows, 'salesOrderDescription') || undefined,
    proformaInvoiceNumber:
      firstNonEmpty(rows, 'proformaInvoiceNumber') || undefined,
    ...(serviceDeliveryDate ? { serviceDeliveryDate } : {}),
    extraDiscountAmount:
      firstNonEmpty(rows, 'extraDiscountAmount') || '0.00',
    receiver: {
      type: firstNonEmpty(rows, 'receiverType') || 'B',
      id: firstNonEmpty(rows, 'receiverId'),
      name: firstNonEmpty(rows, 'receiverName'),
      address: {
        country: firstNonEmpty(rows, 'receiverCountry') || 'EG',
        governate: firstNonEmpty(rows, 'receiverGovernate') || undefined,
        regionCity:
          firstNonEmpty(rows, 'receiverRegionCity') || undefined,
        street: firstNonEmpty(rows, 'receiverStreet') || undefined,
        buildingNumber:
          firstNonEmpty(rows, 'receiverBuildingNumber') || undefined,
        postalCode:
          firstNonEmpty(rows, 'receiverPostalCode') || undefined,
        floor: firstNonEmpty(rows, 'receiverFloor') || undefined,
        room: firstNonEmpty(rows, 'receiverRoom') || undefined,
        landmark: firstNonEmpty(rows, 'receiverLandmark') || undefined,
        additionalInformation:
          firstNonEmpty(rows, 'receiverAdditionalInformation') ||
          undefined,
      },
    },
    payment: buildPayment(head),
    delivery: buildDelivery(head, deliveryDateValidity),
    references: parseReferences(firstNonEmpty(rows, 'references')),
    lines: rows.map((r) => buildLine(r.mapped, currencyCode)),
  };
}

/** Header fields that should be consistent across lines of the same invoice. */
export const HEADER_CONSISTENCY_FIELDS = [
  'dateTimeIssued',
  'documentType',
  'branchCode',
  'currencyCode',
  'receiverId',
  'receiverName',
  'receiverType',
] as const;

export function headerConflicts(group: InvoiceGroup): string[] {
  const conflicts: string[] = [];
  for (const field of HEADER_CONSISTENCY_FIELDS) {
    const values = new Set(
      group.rows
        .map((r) => cell(r.mapped, field))
        .filter((v) => v.length > 0),
    );
    if (values.size > 1) {
      conflicts.push(field);
    }
  }
  return conflicts;
}
