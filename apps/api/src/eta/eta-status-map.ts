/**
 * Single ETA → local DocumentStatus mapper (FR status model / T009).
 * Intake refusal is NOT mapped here — refused-at-intake stays SIGNED via 202 map.
 */

export type LocalDocumentStatus =
  | 'DRAFT'
  | 'READY'
  | 'PENDING_SIGNATURE'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'VALID'
  | 'INVALID'
  | 'CANCELLED'
  | 'REJECTED';

const ETA_TO_LOCAL: Record<string, LocalDocumentStatus> = {
  valid: 'VALID',
  invalid: 'INVALID',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  rejected: 'REJECTED',
  submitted: 'SUBMITTED',
  new: 'SUBMITTED',
};

/**
 * Map an ETA status string (poll / webhook) to local DocumentStatus.
 * Returns null when the value is unrecognized (caller → needsAttention).
 */
export function mapEtaStatusToLocal(etaStatus: string | null | undefined): LocalDocumentStatus | null {
  if (etaStatus == null || etaStatus.trim() === '') return null;
  const key = etaStatus.trim().toLowerCase();
  return ETA_TO_LOCAL[key] ?? null;
}

/** Terminal statuses that stop polling for a document. */
export function isTerminalLocalStatus(status: LocalDocumentStatus): boolean {
  return (
    status === 'VALID' ||
    status === 'INVALID' ||
    status === 'CANCELLED' ||
    status === 'REJECTED'
  );
}
