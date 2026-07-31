import {
  calculateDocumentTotals,
  calculateLine,
  type LineInput,
} from '../calculate-totals.js';
import type { JsonObject } from '../canonical-serialize.js';
import { formatEtaDateTimeIssued, toEtaDecimalNumber } from '../eta-formats.js';

export type DocumentKind =
  | 'INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'EXPORT_INVOICE'
  | 'EXPORT_CREDIT_NOTE'
  | 'EXPORT_DEBIT_NOTE';

export const KIND_TO_ETA_TYPE: Record<DocumentKind, string> = {
  INVOICE: 'I',
  CREDIT_NOTE: 'C',
  DEBIT_NOTE: 'D',
  EXPORT_INVOICE: 'EI',
  EXPORT_CREDIT_NOTE: 'EC',
  EXPORT_DEBIT_NOTE: 'ED',
};

export type BuildContext = {
  kind: DocumentKind;
  documentTypeVersion: string;
  dateTimeIssued: string;
  internalID: string;
  issuer: JsonObject;
  receiver: JsonObject;
  lines: LineInput[];
  extraDiscountAmount?: string;
  /** ETA references: UUID string[] for C/D/EC/ED */
  references?: string[] | JsonObject | null;
  taxpayerActivityCode?: string;
  purchaseOrderReference?: string;
  purchaseOrderDescription?: string;
  salesOrderReference?: string;
  salesOrderDescription?: string;
  proformaInvoiceNumber?: string;
  serviceDeliveryDate?: string;
  payment?: JsonObject | null;
  delivery?: JsonObject | null;
  /** Optional FX / export extras preserved in order after core fields */
  extras?: JsonObject;
};

export type BuiltDocument = {
  etaPayload: JsonObject;
  lineComputed: ReturnType<typeof calculateLine>[];
  totals: ReturnType<typeof calculateDocumentTotals>;
};

function compactObject(obj: JsonObject | null | undefined): JsonObject | undefined {
  if (!obj) return undefined;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function n(value: string | number): number {
  return toEtaDecimalNumber(value);
}

function buildLines(lines: LineInput[]) {
  return lines.map((line) => {
    const c = calculateLine(line);
    const currencySold = line.currencySold || 'EGP';
    const amountEGP = line.amountEGP ?? line.unitPrice;
    const unitValue: JsonObject = {
      currencySold,
      amountEGP: n(amountEGP),
    };
    if (currencySold !== 'EGP') {
      if (line.amountSold != null && line.amountSold !== '') {
        unitValue.amountSold = n(line.amountSold);
      }
      if (line.currencyExchangeRate != null && line.currencyExchangeRate !== '') {
        unitValue.currencyExchangeRate = n(line.currencyExchangeRate);
      }
    }

    const obj: JsonObject = {
      description: line.description,
      itemType: line.itemType,
      itemCode: line.itemCode,
      unitType: line.unitType,
      quantity: n(line.quantity),
      unitValue,
      salesTotal: n(c.salesTotal),
      total: n(c.total),
      valueDifference: n(c.valueDifference),
      totalTaxableFees: n(c.totalTaxableFees),
      netTotal: n(c.netTotal),
      itemsDiscount: n(c.itemsDiscount),
      discount: {
        rate: n(line.discountRate ?? '0'),
        amount: n(c.discount),
      },
      taxableItems: c.taxAmounts.map((t) => ({
        taxType: t.taxType,
        amount: n(t.amount),
        subType: t.subType,
        rate: n(t.rate),
      })),
    };
    if (line.internalCode) obj.internalCode = line.internalCode;
    if (line.weightUnitType) obj.weightUnitType = line.weightUnitType;
    if (line.weightQuantity) obj.weightQuantity = n(line.weightQuantity);
    return { computed: c, payload: obj };
  });
}

export function buildDocumentPayload(ctx: BuildContext): BuiltDocument {
  const builtLines = buildLines(ctx.lines);
  const lineComputed = builtLines.map((b) => b.computed);
  const totals = calculateDocumentTotals(lineComputed, ctx.extraDiscountAmount ?? '0.00');

  const etaPayload: JsonObject = {
    issuer: ctx.issuer,
    receiver: ctx.receiver,
    documentType: KIND_TO_ETA_TYPE[ctx.kind],
    documentTypeVersion: ctx.documentTypeVersion,
    dateTimeIssued: formatEtaDateTimeIssued(ctx.dateTimeIssued),
    taxpayerActivityCode: ctx.taxpayerActivityCode ?? '',
    internalID: ctx.internalID,
  };

  if (ctx.purchaseOrderReference) {
    etaPayload.purchaseOrderReference = ctx.purchaseOrderReference;
  }
  if (ctx.purchaseOrderDescription) {
    etaPayload.purchaseOrderDescription = ctx.purchaseOrderDescription;
  }
  if (ctx.salesOrderReference) {
    etaPayload.salesOrderReference = ctx.salesOrderReference;
  }
  if (ctx.salesOrderDescription) {
    etaPayload.salesOrderDescription = ctx.salesOrderDescription;
  }
  if (ctx.proformaInvoiceNumber) {
    etaPayload.proformaInvoiceNumber = ctx.proformaInvoiceNumber;
  }
  if (ctx.serviceDeliveryDate) {
    etaPayload.serviceDeliveryDate = ctx.serviceDeliveryDate;
  }

  const payment = compactObject(ctx.payment ?? undefined);
  if (payment) etaPayload.payment = payment;
  const delivery = compactObject(ctx.delivery ?? undefined);
  if (delivery) {
    if (typeof delivery.grossWeight === 'string') {
      delivery.grossWeight = n(delivery.grossWeight);
    }
    if (typeof delivery.netWeight === 'string') {
      delivery.netWeight = n(delivery.netWeight);
    }
    if (typeof delivery.dateValidity === 'string' && delivery.dateValidity) {
      try {
        delivery.dateValidity = formatEtaDateTimeIssued(delivery.dateValidity);
      } catch {
        /* leave as-is; validator will catch */
      }
    }
    etaPayload.delivery = delivery;
  }

  if (ctx.references != null) {
    etaPayload.references = ctx.references as JsonObject | string[];
  }

  etaPayload.invoiceLines = builtLines.map((b) => b.payload);
  etaPayload.totalDiscountAmount = n(totals.totalDiscountAmount);
  etaPayload.totalSalesAmount = n(totals.totalSalesAmount);
  etaPayload.netAmount = n(totals.netAmount);
  etaPayload.taxTotals = totals.taxTotals.map((t) => ({
    taxType: t.taxType,
    amount: n(t.amount),
  }));
  etaPayload.totalAmount = n(totals.totalAmount);
  etaPayload.extraDiscountAmount = n(totals.extraDiscountAmount);
  etaPayload.totalItemsDiscountAmount = n(totals.totalItemsDiscountAmount);

  if (ctx.extras) {
    for (const [k, v] of Object.entries(ctx.extras)) {
      etaPayload[k] = v;
    }
  }

  return { etaPayload, lineComputed, totals };
}

export function buildInvoice(ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind: 'INVOICE' });
}

export function buildCreditNote(ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind: 'CREDIT_NOTE' });
}

export function buildDebitNote(ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind: 'DEBIT_NOTE' });
}

export function buildExportInvoice(ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind: 'EXPORT_INVOICE' });
}

export function buildExportCreditNote(ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind: 'EXPORT_CREDIT_NOTE' });
}

export function buildExportDebitNote(ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind: 'EXPORT_DEBIT_NOTE' });
}

export function buildByKind(kind: DocumentKind, ctx: Omit<BuildContext, 'kind'>): BuiltDocument {
  return buildDocumentPayload({ ...ctx, kind });
}
