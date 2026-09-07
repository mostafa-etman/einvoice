/** Pre-submission actions: validate / mark ready / send for signature. */
export function canPrepareDocumentForSubmit(
  origin: string,
  status: string,
): boolean {
  if (origin === 'ETA_SYNC') return false;
  return (
    status === 'DRAFT' || status === 'READY' || status === 'PENDING_SIGNATURE'
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
