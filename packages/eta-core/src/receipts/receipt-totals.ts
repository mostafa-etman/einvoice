import {
  calculateDocumentTotals,
  calculateLine,
  type LineComputed,
  type LineInput,
} from '../calculate-totals.js';
import { add, formatMoney, mul } from '../money.js';
import type {
  ReceiptDiscountEntry,
  ReceiptExtraDiscount,
  ReceiptLineInput,
} from './types.js';

function entryAmount(entry: ReceiptDiscountEntry, base: string): string {
  if (entry.amount != null && entry.amount !== '') {
    return formatMoney(entry.amount);
  }
  if (entry.rate != null && entry.rate !== '') {
    return mul(base, (Number(entry.rate) / 100).toString());
  }
  return '0.00';
}

function sumEntries(entries: ReceiptDiscountEntry[] | undefined, base: string): string {
  let sum = '0.00';
  for (const entry of entries ?? []) {
    sum = add(sum, entryAmount(entry, base));
  }
  return sum;
}

export function commercialDiscountTotal(line: ReceiptLineInput, salesTotal: string): string {
  let sum = sumEntries(line.commercialDiscountData, salesTotal);
  if (line.additionalCommercialDiscount) {
    sum = add(sum, entryAmount(line.additionalCommercialDiscount, salesTotal));
  }
  return sum;
}

export function itemDiscountTotal(line: ReceiptLineInput, salesTotal: string): string {
  let sum = sumEntries(line.itemDiscountData, salesTotal);
  if (line.additionalItemDiscount) {
    sum = add(sum, entryAmount(line.additionalItemDiscount, salesTotal));
  }
  return sum;
}

export function extraReceiptDiscountTotal(
  extras: ReceiptExtraDiscount[] | undefined,
): string {
  let sum = '0.00';
  for (const extra of extras ?? []) {
    sum = add(sum, extra.amount || '0');
  }
  return sum;
}

export function toInvoiceLineInput(line: ReceiptLineInput): LineInput {
  const salesTotal = mul(line.quantity, line.unitPrice);
  return {
    description: line.description,
    itemType: line.itemType,
    itemCode: line.itemCode,
    unitType: line.unitType,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: commercialDiscountTotal(line, salesTotal),
    taxes: line.taxes,
    itemsDiscount: itemDiscountTotal(line, salesTotal),
    valueDifference: line.valueDifference,
    internalCode: line.internalCode,
  };
}

export type ReceiptLineComputed = LineComputed & {
  totalSale: string;
  netSale: string;
};

export function calculateReceiptLine(line: ReceiptLineInput): ReceiptLineComputed {
  const computed = calculateLine(toInvoiceLineInput(line));
  return {
    ...computed,
    totalSale: computed.salesTotal,
    netSale: computed.netTotal,
  };
}

export function calculateReceiptDocumentTotals(
  lines: ReceiptLineComputed[],
  extraReceiptDiscountData?: ReceiptExtraDiscount[],
) {
  const extra = extraReceiptDiscountTotal(extraReceiptDiscountData);
  const totals = calculateDocumentTotals(lines, extra);
  return {
    totalSales: totals.totalSalesAmount,
    totalCommercialDiscount: totals.totalDiscountAmount,
    totalItemsDiscount: totals.totalItemsDiscountAmount,
    extraReceiptDiscount: extra,
    netAmount: totals.netAmount,
    feesAmount: '0.00',
    adjustment: '0.00',
    totalAmount: totals.totalAmount,
    taxTotals: totals.taxTotals,
  };
}
