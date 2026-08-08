/**
 * Egyptian VAT Return (إقرار القيمة المضافة) aggregation helpers.
 * Richer than C1: taxable value + tax by type/subtype/rate; T4 never in net VAT.
 */

import {
  add,
  div,
  formatMoney,
  mul,
  normalizeTaxTypeCode,
} from '@einvoice/eta-core';
import { taxCategory, type TaxCategory } from './report-vat';

export type VatReturnLineIn = {
  taxType: string;
  subType?: string | null;
  rate?: string | null;
  amount?: string | null;
};

export type VatReturnRow = {
  side: 'output' | 'input';
  taxType: string;
  subType: string;
  rate: string;
  category: TaxCategory;
  /** Netted taxable / sales-or-purchase value for this band. */
  taxableValue: string;
  /** Netted tax amount. */
  taxAmount: string;
  documentCount: number;
};

function rowKey(
  side: 'output' | 'input',
  taxType: string,
  subType: string,
  rate: string,
): string {
  return `${side}|${taxType}|${subType}|${rate}`;
}

/** Infer taxable base from tax amount and rate (%). Zero rate → 0 (caller may supply base). */
export function inferTaxableBase(taxAmount: string, rate: string): string {
  const r = Number(rate);
  if (!Number.isFinite(r) || r === 0) return '0.00';
  return formatMoney(div(mul(taxAmount, 100), r));
}

export function parseVatReturnTaxLines(json: unknown): VatReturnLineIn[] {
  if (!Array.isArray(json)) return [];
  const out: VatReturnLineIn[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const taxType = String(o.taxType ?? o.TaxType ?? '');
    if (!taxType) continue;
    out.push({
      taxType,
      subType:
        o.subType != null
          ? String(o.subType)
          : o.SubType != null
            ? String(o.SubType)
            : o.subtype != null
              ? String(o.subtype)
              : '',
      rate:
        o.rate != null
          ? String(o.rate)
          : o.Rate != null
            ? String(o.Rate)
            : '0',
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

export class VatReturnAccumulator {
  private readonly map = new Map<string, VatReturnRow>();

  addTaxes(
    side: 'output' | 'input',
    taxes: VatReturnLineIn[],
    sign: 1 | -1,
    /** Document/line net used when rate is 0 or as fallback base share. */
    fallbackTaxable?: string | null,
  ): void {
    const fallback = formatMoney(fallbackTaxable ?? '0');
    const signedFallback = sign === 1 ? fallback : mul(fallback, -1);
    let allocatedFallback = false;

    for (const t of taxes) {
      const taxType = normalizeTaxTypeCode(t.taxType || '');
      if (!taxType) continue;
      const subType = String(t.subType ?? '').trim().toUpperCase() || '—';
      const rate = String(t.rate ?? '').trim() || '0';
      const rawAmt = formatMoney(t.amount ?? '0');
      const taxAmount = sign === 1 ? rawAmt : mul(rawAmt, -1);
      let taxableValue = inferTaxableBase(taxAmount, rate);
      if (taxableValue === '0.00' || taxableValue === '-0.00') {
        // Zero-rated / exempt: attribute document net once to the first such row.
        if (!allocatedFallback && Number(fallback) !== 0) {
          taxableValue = signedFallback;
          allocatedFallback = true;
        }
      }
      const key = rowKey(side, taxType, subType, rate);
      const category = taxCategory(taxType);
      const prev = this.map.get(key);
      if (prev) {
        prev.taxAmount = add(prev.taxAmount, taxAmount);
        prev.taxableValue = add(prev.taxableValue, taxableValue);
        prev.documentCount += 1;
      } else {
        this.map.set(key, {
          side,
          taxType,
          subType,
          rate,
          category,
          taxableValue,
          taxAmount,
          documentCount: 1,
        });
      }
    }
  }

  /** Also track sales/purchase document totals (not tax) for summary boxes. */
  rows(taxTypeFilter?: string): VatReturnRow[] {
    const filter = taxTypeFilter
      ? normalizeTaxTypeCode(taxTypeFilter)
      : '';
    const all = [...this.map.values()].filter((r) =>
      filter ? r.taxType === filter : true,
    );
    all.sort(
      (a, b) =>
        a.side.localeCompare(b.side) ||
        a.taxType.localeCompare(b.taxType) ||
        a.subType.localeCompare(b.subType) ||
        a.rate.localeCompare(b.rate),
    );
    return all;
  }
}

export function sumVatReturn(
  rows: VatReturnRow[],
  pred: (r: VatReturnRow) => boolean,
): { taxableValue: string; taxAmount: string } {
  let taxableValue = '0.00';
  let taxAmount = '0.00';
  for (const r of rows) {
    if (!pred(r)) continue;
    taxableValue = add(taxableValue, r.taxableValue);
    taxAmount = add(taxAmount, r.taxAmount);
  }
  return { taxableValue, taxAmount };
}

export function availableTaxTypes(rows: VatReturnRow[]): string[] {
  return [...new Set(rows.map((r) => r.taxType))].sort();
}
