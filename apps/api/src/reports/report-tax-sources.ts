/**
 * Unified tax extraction for reports — works for LOCAL + ETA_SYNC / synced docs.
 *
 * Synced purchases often store line taxes in rawJson.lineTaxableItems (or only in
 * rawDetailsJson.taxTotals) while taxesJson is [] — same class of bug as the
 * purchase detail screen. Issued ETA_SYNC docs may have taxTotalsJson and/or
 * DocumentLineTax rows.
 */

import { normalizeLineTaxes } from '../documents/local-invoice-pdf';
import {
  extractReceivedLineTaxesRaw,
  mapDetailsLines,
} from '../purchases/received-document.mapper';
import {
  parseTaxTotalsJson,
  type TaxLineIn,
} from './report-vat';
import {
  parseVatReturnTaxLines,
  type VatReturnLineIn,
} from './report-egyptian-vat-return';

export type UnifiedTaxLine = {
  taxType: string;
  subType: string;
  rate: string;
  amount: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function fromNormalized(
  taxes: Array<{ taxType: string; subType: string; rate: string; amount?: string }>,
): UnifiedTaxLine[] {
  return taxes
    .filter((t) => t.taxType || t.amount)
    .map((t) => ({
      taxType: t.taxType || 'T1',
      subType: t.subType || '',
      rate: t.rate || '0',
      amount: t.amount ?? '0',
    }));
}

function fromTotalsJson(raw: unknown): UnifiedTaxLine[] {
  // Prefer VAT-return parser (keeps subType/rate when present).
  const rich = parseVatReturnTaxLines(raw);
  if (rich.length) {
    return rich.map((t) => ({
      taxType: t.taxType,
      subType: String(t.subType ?? ''),
      rate: String(t.rate ?? '0'),
      amount: String(t.amount ?? '0'),
    }));
  }
  return parseTaxTotalsJson(raw).map((t) => ({
    taxType: t.taxType,
    subType: '',
    rate: String(t.rate ?? '0'),
    amount: String(t.amount ?? '0'),
  }));
}

function taxesFromReceivedLine(line: Record<string, unknown>): UnifiedTaxLine[] {
  const raw = extractReceivedLineTaxesRaw(line);
  return fromNormalized(normalizeLineTaxes(raw));
}

/**
 * Resolve deductible/output taxes for a received (purchase) document.
 * Order: line taxes (incl. rawJson.lineTaxableItems) → details taxTotals →
 * summary taxTotals → hydrate lines from rawDetailsJson.
 */
export function extractReceivedDocumentTaxes(doc: {
  rawSummaryJson?: unknown;
  rawDetailsJson?: unknown;
  lines?: Array<{
    taxesJson?: unknown;
    rawJson?: unknown;
    taxes?: unknown;
  }>;
}): UnifiedTaxLine[] {
  const details = asRecord(doc.rawDetailsJson);
  const storedLines = (doc.lines ?? []) as Array<Record<string, unknown>>;

  const fromStoredLines: UnifiedTaxLine[] = [];
  for (const line of storedLines) {
    fromStoredLines.push(...taxesFromReceivedLine(line));
  }
  if (fromStoredLines.length) return fromStoredLines;

  const detailTotals =
    details?.taxTotals ?? details?.TaxTotals ?? null;
  const fromDetails = fromTotalsJson(detailTotals);
  if (fromDetails.length) return fromDetails;

  if (details) {
    const hydrated = mapDetailsLines(details);
    const fromHydrated: UnifiedTaxLine[] = [];
    for (const line of hydrated) {
      fromHydrated.push(
        ...taxesFromReceivedLine({
          taxesJson: line.taxesJson,
          rawJson: line.rawJson,
        }),
      );
    }
    if (fromHydrated.length) return fromHydrated;
  }

  const summary = asRecord(doc.rawSummaryJson);
  const summaryTotals =
    summary?.taxTotals ?? summary?.TaxTotals ?? null;
  return fromTotalsJson(summaryTotals);
}

/**
 * Resolve taxes for an issued (sales) document.
 * Prefer line taxes (subtype/rate); else document taxTotalsJson.
 */
export function extractIssuedDocumentTaxes(doc: {
  taxTotalsJson?: unknown;
  lines?: Array<{
    taxes?: Array<{
      taxType: string;
      subType?: string | null;
      rate?: string | null;
      amount?: string | null;
    }>;
  }>;
}): UnifiedTaxLine[] {
  const fromLines: UnifiedTaxLine[] = [];
  for (const line of doc.lines ?? []) {
    for (const t of line.taxes ?? []) {
      if (!t.taxType && t.amount == null) continue;
      fromLines.push({
        taxType: t.taxType || 'T1',
        subType: String(t.subType ?? ''),
        rate: String(t.rate ?? '0'),
        amount: String(t.amount ?? '0'),
      });
    }
  }
  if (fromLines.length) return fromLines;
  return fromTotalsJson(doc.taxTotalsJson);
}

export function toTaxLineIn(taxes: UnifiedTaxLine[]): TaxLineIn[] {
  return taxes.map((t) => ({
    taxType: t.taxType,
    rate: t.rate,
    amount: t.amount,
  }));
}

export function toVatReturnLineIn(taxes: UnifiedTaxLine[]): VatReturnLineIn[] {
  return taxes.map((t) => ({
    taxType: t.taxType,
    subType: t.subType,
    rate: t.rate,
    amount: t.amount,
  }));
}
