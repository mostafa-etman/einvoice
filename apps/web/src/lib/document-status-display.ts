/** Prefer ETA portal status over a stale local DRAFT badge. */
export function resolveDocumentStatus(
  status: string,
  etaStatus?: string | null,
): string {
  const eta = (etaStatus ?? '').trim().toLowerCase();
  if (
    status === 'CANCELLED' ||
    eta === 'cancelled' ||
    eta === 'canceled'
  ) {
    return 'CANCELLED';
  }
  if (status === 'REJECTED' || eta === 'rejected') return 'REJECTED';
  if (status === 'INVALID' || eta === 'invalid') return 'INVALID';
  if (
    (status === 'DRAFT' ||
      status === 'READY' ||
      status === 'PENDING_SIGNATURE') &&
    (eta === 'valid' || eta === 'submitted' || eta === 'new')
  ) {
    return eta === 'valid' ? 'VALID' : 'SUBMITTED';
  }
  if (status === 'DRAFT' && eta === 'valid') return 'VALID';
  return status;
}
