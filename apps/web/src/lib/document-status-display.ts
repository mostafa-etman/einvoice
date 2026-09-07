/** Prefer ETA cancelled/rejected over a stale local VALID badge. */
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
  return status;
}
