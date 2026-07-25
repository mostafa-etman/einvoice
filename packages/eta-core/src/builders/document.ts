import {
  calculateDocumentTotals,
  calculateLine,
  type LineInput,
} from '../calculate-totals.js';
import type { JsonObject } from '../canonical-serialize.js';

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
  references?: JsonObject | null;
  taxpayerActivityCode?: string;
  /** Optional FX / export extras preserved in order after core fields */
  extras?: JsonObject;
};

export type BuiltDocument = {
  etaPayload: JsonObject;
  lineComputed: ReturnType<typeof calculateLine>[];
  totals: ReturnType<typeof calculateDocumentTotals>;
};

function buildLines(lines: LineInput[]) {
  return lines.map((line, idx) => {
    const c = calculateLine(line);
    const obj: JsonObject = {
      description: line.description,
      itemType: line.itemType,
      itemCode: line.itemCode,
      unitType: line.unitType,
      quantity: line.quantity,
      unitValue: {
        currencySold: 'EGP',
        amountEGP: line.unitPrice,
      },
      salesTotal: c.salesTotal,
      total: c.total,
      valueDifference: c.valueDifference,
      totalTaxableFees: c.totalTaxableFees,
      netTotal: c.netTotal,
      itemsDiscount: c.itemsDiscount,
      discount: {
        rate: line.discountRate ?? '0',
        amount: c.discount,
      },
      taxableItems: c.taxAmounts.map((t) => ({
        taxType: t.taxType,
        amount: t.amount,
        subType: t.subType,
        rate: t.rate,
      })),
    };
    void idx;
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
    dateTimeIssued: ctx.dateTimeIssued,
    taxpayerActivityCode: ctx.taxpayerActivityCode ?? '',
    internalID: ctx.internalID,
    invoiceLines: builtLines.map((b) => b.payload),
    totalDiscountAmount: totals.totalDiscountAmount,
    totalSalesAmount: totals.totalSalesAmount,
    netAmount: totals.netAmount,
    taxTotals: totals.taxTotals.map((t) => ({
      taxType: t.taxType,
      amount: t.amount,
    })),
    totalAmount: totals.totalAmount,
    extraDiscountAmount: totals.extraDiscountAmount,
    totalItemsDiscountAmount: totals.totalItemsDiscountAmount,
  };

  if (ctx.references) {
    etaPayload.references = ctx.references;
  }
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
