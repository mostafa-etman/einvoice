import { isValidEtaInternalId, type DocumentKind } from '@einvoice/eta-core';

export function creditNoteKindForInvoice(
  kind: DocumentKind | string,
): DocumentKind | null {
  if (kind === 'INVOICE') return 'CREDIT_NOTE';
  if (kind === 'EXPORT_INVOICE') return 'EXPORT_CREDIT_NOTE';
  return null;
}

export function returnCreditNoteInternalId(
  sourceInternalId: string,
  nowMs = Date.now(),
): string {
  const stamp = nowMs.toString(36).toUpperCase();
  const cleaned = (sourceInternalId || 'INV').replace(/[^A-Za-z0-9._-]/g, '');
  const budget = Math.max(8, 50 - stamp.length - 2);
  const core = cleaned.slice(0, budget);
  const candidate = `CN${core}${stamp}`.slice(0, 50);
  if (isValidEtaInternalId(candidate)) return candidate;
  const fallback = `CN${stamp}`.slice(0, 50);
  return isValidEtaInternalId(fallback) ? fallback : `CN${stamp.replace(/[^A-Z0-9]/g, '')}`.slice(0, 50);
}
