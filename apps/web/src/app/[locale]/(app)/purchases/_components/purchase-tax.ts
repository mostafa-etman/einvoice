import { formatMoneyDisplay } from '@/lib/format-number';
import type { PurchaseLine, PurchaseLineTax } from '@/lib/api/purchases';

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function partyField(party: unknown, ...keys: string[]): string {
  const obj = asRecord(party);
  if (!obj) return '';
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

export function formatAddress(party: unknown): string {
  const obj = asRecord(party);
  const address = asRecord(obj?.address);
  if (!address) return '';
  return [
    address.country,
    address.governate,
    address.regionCity,
    address.street,
    address.buildingNumber,
    address.postalCode,
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' · ');
}

export function normalizeTax(raw: Record<string, unknown>): PurchaseLineTax | null {
  const taxType = String(raw.taxType ?? raw.TaxType ?? raw.type ?? '').trim();
  const subType = String(
    raw.subType ?? raw.subtype ?? raw.SubType ?? raw.taxSubType ?? '',
  ).trim();
  const rate = String(raw.rate ?? raw.ratePercent ?? raw.Rate ?? '').trim();
  const amount =
    raw.amount != null
      ? String(raw.amount)
      : raw.Amount != null
        ? String(raw.Amount)
        : undefined;
  if (!taxType && !subType && amount == null) return null;
  return { taxType, subType, rate, amount };
}

/**
 * Same sources the PDF uses: normalized `taxes`, non-empty taxesJson,
 * then ETA lineTaxableItems / taxableItems on rawJson.
 */
export function lineTaxes(line: PurchaseLine): PurchaseLineTax[] {
  if (Array.isArray(line.taxes) && line.taxes.length) {
    return (line.taxes as Array<Record<string, unknown>>)
      .map(normalizeTax)
      .filter((t): t is PurchaseLineTax => t != null);
  }
  if (Array.isArray(line.taxesJson) && line.taxesJson.length) {
    return (line.taxesJson as Array<Record<string, unknown>>)
      .map(normalizeTax)
      .filter((t): t is PurchaseLineTax => t != null);
  }
  const raw = asRecord(line.rawJson);
  if (raw) {
    for (const key of [
      'lineTaxableItems',
      'LineTaxableItems',
      'taxableItems',
      'TaxableItems',
      'taxItems',
      'taxes',
    ]) {
      const v = raw[key];
      if (Array.isArray(v) && v.length) {
        return (v as Array<Record<string, unknown>>)
          .map(normalizeTax)
          .filter((t): t is PurchaseLineTax => t != null);
      }
    }
  }
  return [];
}

export function formatLineTaxLabel(tx: PurchaseLineTax): string {
  const code = [tx.taxType, tx.subType].filter(Boolean).join('/');
  const rate = tx.rate ? `${tx.rate}%` : '';
  const amt =
    tx.amount != null && tx.amount !== ''
      ? `=${formatMoneyDisplay(tx.amount)}`
      : '';
  return [code, rate, amt].filter(Boolean).join(' ');
}
