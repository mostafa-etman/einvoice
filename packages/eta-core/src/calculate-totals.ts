import { add, formatMoney, mul, sub, type DecimalInput } from './money.js';
import {
  etaTaxDirection,
  findDuplicateTaxTypes,
  isFixedAmountTaxType,
  isNonTaxableFeeTaxType,
  isTaxableFeeTaxType,
  normalizeTaxTypeCode,
  type EtaTaxDirection,
} from './tax-modes.js';

export type LineTaxInput = {
  taxType: string;
  subType: string;
  rate: string;
  /** Fixed-amount types (T3, T6) carry the amount directly; ETA requires rate 0. */
  amount?: string;
};

export type LineInput = {
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  discountRate?: string;
  taxes?: LineTaxInput[];
  itemsDiscount?: string;
  valueDifference?: string;
  currencySold?: string;
  amountEGP?: string;
  amountSold?: string;
  currencyExchangeRate?: string;
  internalCode?: string;
  weightUnitType?: string;
  weightQuantity?: string;
};

export type LineTaxComputed = {
  taxType: string;
  subType: string;
  rate: string;
  /** Always positive — ETA requires taxableItems[*].amount >= 0. */
  amount: string;
  direction: EtaTaxDirection;
};

export type LineComputed = {
  salesTotal: string;
  discount: string;
  netTotal: string;
  taxAmounts: LineTaxComputed[];
  additiveTaxTotal: string;
  deductibleTaxTotal: string;
  total: string;
  itemsDiscount: string;
  valueDifference: string;
  totalTaxableFees: string;
};

export type DocumentTotals = {
  totalSalesAmount: string;
  totalDiscountAmount: string;
  netAmount: string;
  totalAmount: string;
  totalItemsDiscountAmount: string;
  extraDiscountAmount: string;
  taxTotals: Array<{ taxType: string; amount: string }>;
};

function lineDiscount(input: LineInput, salesTotal: string): string {
  if (input.discountAmount != null && input.discountAmount !== '') {
    return formatMoney(input.discountAmount);
  }
  if (input.discountRate != null && input.discountRate !== '') {
    return mul(salesTotal, (Number(input.discountRate) / 100).toString());
  }
  return '0.00';
}

function rateFraction(rate: string): string {
  return (Number(rate) / 100).toString();
}

/** Explicit amount wins for fixed-amount types; otherwise rate applied to a base. */
function taxAmountFrom(tax: LineTaxInput, base: string): string {
  if (
    isFixedAmountTaxType(tax.taxType) &&
    tax.amount != null &&
    tax.amount !== ''
  ) {
    return formatMoney(tax.amount);
  }
  return mul(base, rateFraction(tax.rate));
}

function displayRate(rate: string): string {
  return rate.includes('.') ? formatMoney(rate) : rate;
}

export type EtaTaxAmountLike = { taxType: string; amount: DecimalInput };

export type EtaItemTotalBreakdown = {
  netTotal: string;
  itemsDiscount: string;
  additiveTaxTotal: string;
  deductibleTaxTotal: string;
  total: string;
};

/**
 * ETA's item-total equation (SDK "Main Calculations" rule 17):
 *
 *   total = netTotal
 *         + T1 + T2 + T3 + Sum(T5..T12) + Sum(T13..T20)   (additive)
 *         - T4                                            (withholding)
 *         - itemsDiscount
 *
 * Taxable-item amounts stay positive in the payload; only their contribution
 * to the total is signed.
 */
export function estimateEtaItemTotal(input: {
  netTotal: DecimalInput;
  itemsDiscount?: DecimalInput;
  taxes?: EtaTaxAmountLike[];
}): EtaItemTotalBreakdown {
  const netTotal = formatMoney(input.netTotal);
  const itemsDiscount = formatMoney(input.itemsDiscount ?? '0.00');
  let additiveTaxTotal = '0.00';
  let deductibleTaxTotal = '0.00';

  for (const t of input.taxes ?? []) {
    const amount = formatMoney(t.amount);
    if (etaTaxDirection(t.taxType) === 'deductible') {
      deductibleTaxTotal = add(deductibleTaxTotal, amount);
    } else {
      additiveTaxTotal = add(additiveTaxTotal, amount);
    }
  }

  const total = sub(
    sub(add(netTotal, additiveTaxTotal), deductibleTaxTotal),
    itemsDiscount,
  );

  return { netTotal, itemsDiscount, additiveTaxTotal, deductibleTaxTotal, total };
}

/**
 * Tax amounts in ETA's dependency order: fees feed the table-tax base, the
 * table taxes feed the VAT base, and withholding is charged on the net amount
 * after the items discount.
 */
function computeTaxAmounts(
  taxes: LineTaxInput[],
  ctx: { netTotal: string; itemsDiscount: string; valueDifference: string },
): { taxAmounts: LineTaxComputed[]; totalTaxableFees: string } {
  const amounts = new Map<string, string>();
  const codeOf = (t: LineTaxInput) => normalizeTaxTypeCode(t.taxType);
  const amountOf = (code: string) => amounts.get(code) ?? '0.00';

  // Fixed-amount types (T3, T6): amount is supplied, rate is 0.
  for (const t of taxes) {
    if (isFixedAmountTaxType(t.taxType)) {
      if (t.amount == null || t.amount === '') {
        throw new Error(
          `Fixed-amount tax type ${t.taxType} requires an explicit amount`,
        );
      }
      amounts.set(codeOf(t), formatMoney(t.amount));
    }
  }

  // Fees (T5-T12, T13-T20) are charged on netTotal.
  let totalTaxableFees = '0.00';
  for (const t of taxes) {
    const code = codeOf(t);
    if (!amounts.has(code) && (isTaxableFeeTaxType(code) || isNonTaxableFeeTaxType(code))) {
      amounts.set(code, taxAmountFrom(t, ctx.netTotal));
    }
    if (isTaxableFeeTaxType(code)) {
      totalTaxableFees = add(totalTaxableFees, amountOf(code));
    }
  }

  const feeBase = add(add(ctx.netTotal, totalTaxableFees), ctx.valueDifference);
  const byCode = new Map(taxes.map((t) => [codeOf(t), t]));

  // Table tax (T2) is part of the VAT base, so it has to be resolved first.
  const t2 = byCode.get('T2');
  if (t2 && !amounts.has('T2')) {
    amounts.set('T2', taxAmountFrom(t2, add(feeBase, amountOf('T3'))));
  }
  const t1 = byCode.get('T1');
  if (t1 && !amounts.has('T1')) {
    const vatBase = add(add(feeBase, amountOf('T3')), amountOf('T2'));
    amounts.set('T1', taxAmountFrom(t1, vatBase));
  }

  for (const t of taxes) {
    const code = codeOf(t);
    if (amounts.has(code)) continue;
    const base = code === 'T4' ? sub(ctx.netTotal, ctx.itemsDiscount) : feeBase;
    amounts.set(code, taxAmountFrom(t, base));
  }

  const taxAmounts = taxes.map((t) => ({
    taxType: t.taxType,
    subType: t.subType,
    rate: displayRate(t.rate),
    amount: amountOf(codeOf(t)),
    direction: etaTaxDirection(t.taxType),
  }));

  return { taxAmounts, totalTaxableFees };
}

export function calculateLine(input: LineInput): LineComputed {
  const taxes = input.taxes ?? [];
  const dupes = findDuplicateTaxTypes(taxes);
  if (dupes.length) {
    throw new Error(
      `Duplicate TaxType on invoice line (must be unique): ${dupes.join(', ')}`,
    );
  }

  const salesTotal = mul(input.quantity, input.unitPrice);
  const discount = lineDiscount(input, salesTotal);
  const itemsDiscount = formatMoney(input.itemsDiscount ?? '0.00');
  const valueDifference = formatMoney(input.valueDifference ?? '0.00');
  const netTotal = sub(salesTotal, discount);

  // Empty taxes → taxableItems: [] and no contribution to taxTotals / totalAmount.
  const { taxAmounts, totalTaxableFees } = computeTaxAmounts(taxes, {
    netTotal,
    itemsDiscount,
    valueDifference,
  });

  const breakdown = estimateEtaItemTotal({ netTotal, itemsDiscount, taxes: taxAmounts });

  return {
    salesTotal,
    discount,
    netTotal,
    taxAmounts,
    additiveTaxTotal: breakdown.additiveTaxTotal,
    deductibleTaxTotal: breakdown.deductibleTaxTotal,
    total: breakdown.total,
    itemsDiscount,
    valueDifference,
    totalTaxableFees,
  };
}

/**
 * Document totals per ETA "Document validation rules" (invoice level):
 *   netAmount   = Sum(invoiceLines.netTotal)          — extra discount excluded
 *   taxTotals   = Sum(taxableItems.amount) per type   — withholding stays positive
 *   totalAmount = Sum(invoiceLines.total) - extraDiscountAmount
 */
export function calculateDocumentTotals(
  lines: LineComputed[],
  extraDiscount: DecimalInput = '0.00',
): DocumentTotals {
  const extraDiscountAmount = formatMoney(extraDiscount);
  let totalSalesAmount = '0.00';
  let totalDiscountAmount = '0.00';
  let totalItemsDiscountAmount = '0.00';
  let netAmount = '0.00';
  let lineTotals = '0.00';
  const taxMap = new Map<string, string>();

  for (const line of lines) {
    totalSalesAmount = add(totalSalesAmount, line.salesTotal);
    totalDiscountAmount = add(totalDiscountAmount, line.discount);
    totalItemsDiscountAmount = add(totalItemsDiscountAmount, line.itemsDiscount);
    netAmount = add(netAmount, line.netTotal);
    lineTotals = add(lineTotals, line.total);
    for (const t of line.taxAmounts) {
      taxMap.set(t.taxType, add(taxMap.get(t.taxType) ?? '0.00', t.amount));
    }
  }

  return {
    totalSalesAmount,
    totalDiscountAmount,
    netAmount,
    totalAmount: sub(lineTotals, extraDiscountAmount),
    totalItemsDiscountAmount,
    extraDiscountAmount,
    taxTotals: [...taxMap.entries()].map(([taxType, amount]) => ({ taxType, amount })),
  };
}
