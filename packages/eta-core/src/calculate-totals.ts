import { add, formatMoney, mul, sub, type DecimalInput } from './money.js';

export type LineTaxInput = {
  taxType: string;
  subType: string;
  rate: string;
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
  totalTaxableFees?: string;
};

export type LineComputed = {
  salesTotal: string;
  discount: string;
  netTotal: string;
  taxAmounts: Array<{ taxType: string; subType: string; rate: string; amount: string }>;
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

export function calculateLine(input: LineInput): LineComputed {
  const salesTotal = mul(input.quantity, input.unitPrice);
  const discount = lineDiscount(input, salesTotal);
  const itemsDiscount = formatMoney(input.itemsDiscount ?? '0.00');
  const valueDifference = formatMoney(input.valueDifference ?? '0.00');
  const totalTaxableFees = formatMoney(input.totalTaxableFees ?? '0.00');
  const netTotal = sub(salesTotal, discount);
  const taxableBase = add(add(netTotal, totalTaxableFees), valueDifference);

  const taxAmounts = (input.taxes ?? []).map((t) => {
    const rateFraction = (Number(t.rate) / 100).toString();
    const amount = mul(taxableBase, rateFraction);
    return {
      taxType: t.taxType,
      subType: t.subType,
      rate: t.rate.includes('.') ? formatMoney(t.rate) : t.rate,
      amount,
    };
  });

  const taxSum = taxAmounts.reduce((acc, t) => add(acc, t.amount), '0.00');
  const total = add(netTotal, taxSum);

  return {
    salesTotal,
    discount,
    netTotal,
    taxAmounts,
    total,
    itemsDiscount,
    valueDifference,
    totalTaxableFees,
  };
}

export function calculateDocumentTotals(
  lines: LineComputed[],
  extraDiscount: DecimalInput = '0.00',
): DocumentTotals {
  const extraDiscountAmount = formatMoney(extraDiscount);
  let totalSalesAmount = '0.00';
  let totalLineDiscount = '0.00';
  let totalItemsDiscountAmount = '0.00';
  let netBeforeExtra = '0.00';
  let taxBeforeExtra = '0.00';
  const taxMap = new Map<string, string>();

  for (const line of lines) {
    totalSalesAmount = add(totalSalesAmount, line.salesTotal);
    totalLineDiscount = add(totalLineDiscount, line.discount);
    totalItemsDiscountAmount = add(totalItemsDiscountAmount, line.itemsDiscount);
    netBeforeExtra = add(netBeforeExtra, line.netTotal);
    for (const t of line.taxAmounts) {
      taxBeforeExtra = add(taxBeforeExtra, t.amount);
      taxMap.set(t.taxType, add(taxMap.get(t.taxType) ?? '0.00', t.amount));
    }
  }

  const totalDiscountAmount = add(totalLineDiscount, extraDiscountAmount);
  const netAmount = sub(netBeforeExtra, extraDiscountAmount);
  const totalAmount = add(netAmount, taxBeforeExtra);

  return {
    totalSalesAmount,
    totalDiscountAmount,
    netAmount,
    totalAmount,
    totalItemsDiscountAmount,
    extraDiscountAmount,
    taxTotals: [...taxMap.entries()].map(([taxType, amount]) => ({ taxType, amount })),
  };
}
