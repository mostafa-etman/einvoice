import {
  ETA_VAT_TAX_TYPE,
  add,
  formatMoney,
  mul,
  normalizeTaxTypeCode,
} from '@einvoice/eta-core';

export type TaxCategory = 'vat' | 'withholding' | 'other';

export function taxCategory(taxType: string): TaxCategory {
  const code = normalizeTaxTypeCode(taxType);
  if (code === ETA_VAT_TAX_TYPE) return 'vat';
  if (code === 'T4') return 'withholding';
  return 'other';
}

export type TaxLineIn = {
  taxType: string;
  rate?: string | null;
  amount?: string | null;
};

export type VatBreakdownRow = {
  taxType: string;
  rate: string;
  amount: string;
  category: TaxCategory;
};

/** Apply document netting sign to a tax amount string. */
export function signedTaxAmount(amount: string | null | undefined, sign: 1 | -1): string {
  const raw = formatMoney(amount ?? '0');
  return sign === 1 ? raw : mul(raw, -1);
}

export function accumulateTaxRows(
  rows: Map<string, VatBreakdownRow>,
  taxes: TaxLineIn[],
  sign: 1 | -1,
): void {
  for (const t of taxes) {
    const taxType = normalizeTaxTypeCode(t.taxType || '');
    if (!taxType) continue;
    const rate = String(t.rate ?? '').trim() || '0';
    const amount = signedTaxAmount(t.amount, sign);
    const key = `${taxType}|${rate}`;
    const category = taxCategory(taxType);
    const prev = rows.get(key);
    if (prev) {
      prev.amount = add(prev.amount, amount);
    } else {
      rows.set(key, { taxType, rate, amount, category });
    }
  }
}

export function splitVatBreakdown(rows: Iterable<VatBreakdownRow>): {
  vat: VatBreakdownRow[];
  withholding: VatBreakdownRow[];
  other: VatBreakdownRow[];
  vatTotal: string;
  withholdingTotal: string;
  otherTotal: string;
} {
  const vat: VatBreakdownRow[] = [];
  const withholding: VatBreakdownRow[] = [];
  const other: VatBreakdownRow[] = [];
  let vatTotal = '0.00';
  let withholdingTotal = '0.00';
  let otherTotal = '0.00';
  for (const row of rows) {
    if (row.category === 'vat') {
      vat.push(row);
      vatTotal = add(vatTotal, row.amount);
    } else if (row.category === 'withholding') {
      withholding.push(row);
      withholdingTotal = add(withholdingTotal, row.amount);
    } else {
      other.push(row);
      otherTotal = add(otherTotal, row.amount);
    }
  }
  const sortFn = (a: VatBreakdownRow, b: VatBreakdownRow) =>
    a.taxType.localeCompare(b.taxType) || a.rate.localeCompare(b.rate);
  vat.sort(sortFn);
  withholding.sort(sortFn);
  other.sort(sortFn);
  return { vat, withholding, other, vatTotal, withholdingTotal, otherTotal };
}

export function parseTaxTotalsJson(json: unknown): TaxLineIn[] {
  if (!Array.isArray(json)) return [];
  const out: TaxLineIn[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const taxType = String(o.taxType ?? o.TaxType ?? '');
    if (!taxType) continue;
    out.push({
      taxType,
      rate: o.rate != null ? String(o.rate) : o.Rate != null ? String(o.Rate) : '0',
      amount:
        o.amount != null
          ? String(o.amount)
          : o.Amount != null
            ? String(o.Amount)
            : '0',
    });
  }
  return out;
}
