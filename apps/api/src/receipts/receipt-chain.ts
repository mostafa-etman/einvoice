/** POS previousUUID chain rules for receipt submit (local save still stamps uuid). */

export function lastUuidAfterAccept(
  lastReceiptUuid: string,
  acceptedUuid: string,
  previousUuid: string,
): string {
  if (
    lastReceiptUuid === acceptedUuid ||
    lastReceiptUuid === previousUuid ||
    lastReceiptUuid === ''
  ) {
    return acceptedUuid;
  }
  return lastReceiptUuid;
}

/** Rejects must not leave a failed uuid as the POS chain tip. */
export function lastUuidAfterReject(
  lastReceiptUuid: string,
  rejectedUuid: string,
  previousUuid: string,
): string {
  if (lastReceiptUuid === rejectedUuid) {
    return previousUuid;
  }
  return lastReceiptUuid;
}

export function isStructuralChainTip(
  receiptUuid: string,
  siblingPreviousUuids: string[],
): boolean {
  return !siblingPreviousUuids.includes(receiptUuid);
}
