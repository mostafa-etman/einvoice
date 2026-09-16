import { resolveDocumentStatus } from './document-status-display';

/** Pre-submission actions: validate / mark ready / send for signature. */
export function canPrepareDocumentForSubmit(
  origin: string,
  status: string,
): boolean {
  if (origin === 'ETA_SYNC') return false;
  return (
    status === 'DRAFT' ||
    status === 'READY' ||
    status === 'PENDING_SIGNATURE' ||
    status === 'REJECTED' ||
    status === 'INVALID'
  );
}

/** Content edits (header, lines, taxes, totals, save). SIGNED reverts to DRAFT on save. */
export function canEditDocument(origin: string, status: string): boolean {
  if (origin === 'ETA_SYNC') return false;
  return (
    status === 'DRAFT' ||
    status === 'READY' ||
    status === 'SIGNED' ||
    status === 'REJECTED' ||
    status === 'INVALID'
  );
}

/** Credit-note return is only valid against an accepted invoice with an ETA UUID. */
export function canCreateReturnCreditNote(
  kind: string,
  status: string,
  etaUuid?: string | null,
): boolean {
  if (!etaUuid?.trim()) return false;
  if (kind !== 'INVOICE' && kind !== 'EXPORT_INVOICE') return false;
  return status === 'VALID';
}

/** Sales invoice kind a credit/debit note may legally reference. */
export function invoiceKindForNote(
  kind: string,
): 'INVOICE' | 'EXPORT_INVOICE' | null {
  if (kind === 'CREDIT_NOTE' || kind === 'DEBIT_NOTE') return 'INVOICE';
  if (kind === 'EXPORT_CREDIT_NOTE' || kind === 'EXPORT_DEBIT_NOTE') {
    return 'EXPORT_INVOICE';
  }
  return null;
}

export type CreditNoteReferenceCandidate = {
  id: string;
  internalId: string;
  etaUuid: string;
  issueDateTime: string;
  totalAmount: string;
  kind: string;
};

/** Eligible VALID sales invoices with an ETA UUID — never invoice number identity. */
export function mapCreditNoteReferenceItems(
  items: Array<{
    id: string;
    kind?: string | null;
    status?: string | null;
    etaStatus?: string | null;
    etaUuid?: string | null;
    internalId?: string | null;
    issueDateTime?: string | null;
    totalAmount?: string | null;
  }>,
): CreditNoteReferenceCandidate[] {
  const out: CreditNoteReferenceCandidate[] = [];
  const seen = new Set<string>();
  for (const d of items) {
    const kind = String(d.kind ?? '');
    const etaUuid = String(d.etaUuid ?? '').trim();
    const status = resolveDocumentStatus(String(d.status ?? ''), d.etaStatus);
    if (!canCreateReturnCreditNote(kind, status, etaUuid)) continue;
    if (seen.has(etaUuid)) continue;
    seen.add(etaUuid);
    out.push({
      id: String(d.id),
      internalId: String(d.internalId ?? ''),
      etaUuid,
      issueDateTime: String(d.issueDateTime ?? ''),
      totalAmount: String(d.totalAmount ?? ''),
      kind,
    });
  }
  return out;
}
