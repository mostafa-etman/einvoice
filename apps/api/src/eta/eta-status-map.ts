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
  cancelledbytaxpayer: 'CANCELLED',
  canceledbytaxpayer: 'CANCELLED',
  rejected: 'REJECTED',
  submitted: 'SUBMITTED',
  new: 'SUBMITTED',
};

function normalizeEtaStatusKey(etaStatus: string): string {
  return etaStatus
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * Map an ETA status string (poll / webhook) to local DocumentStatus.
 * Returns null when the value is unrecognized (caller → needsAttention).
 */
export function mapEtaStatusToLocal(etaStatus: string | null | undefined): LocalDocumentStatus | null {
  if (etaStatus == null || etaStatus.trim() === '') return null;
  const raw = etaStatus.trim();
  const compact = normalizeEtaStatusKey(raw);
  if (ETA_TO_LOCAL[compact]) return ETA_TO_LOCAL[compact]!;
  if (compact === 'ملغاة' || compact === 'ملغى' || compact === 'ملغي') {
    return 'CANCELLED';
  }
  if (/cancel/i.test(raw) && !/decline|request/i.test(raw)) {
    return 'CANCELLED';
  }
  return ETA_TO_LOCAL[raw.toLowerCase()] ?? null;
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

/**
 * Cancelled/rejected must not be overwritten back to VALID by a stale poll.
 * ETA Cancelled/Rejected/Invalid may still replace VALID.
 */
export function shouldApplyMappedEtaStatus(
  from: LocalDocumentStatus | string,
  to: LocalDocumentStatus,
): boolean {
  if (from === to) return true;
  if (
    (from === 'CANCELLED' || from === 'REJECTED') &&
    to === 'VALID'
  ) {
    return false;
  }
  return true;
}
