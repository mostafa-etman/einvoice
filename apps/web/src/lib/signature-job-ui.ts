export type SignatureJobStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type SignatureSendPhase = 'idle' | 'waiting' | 'signing' | 'retryable';

/** Maps document + latest signature job into Send-for-signature UI state. */
export function signatureSendPhase(
  documentStatus: string,
  jobStatus: SignatureJobStatus | string | null | undefined,
): SignatureSendPhase {
  if (documentStatus !== 'READY') return 'idle';
  if (jobStatus === 'PENDING') return 'waiting';
  if (jobStatus === 'CLAIMED') return 'signing';
  if (jobStatus === 'FAILED' || jobStatus === 'CANCELLED') return 'retryable';
  return 'idle';
}

export function canSendForSignature(
  phase: SignatureSendPhase,
  sending: boolean,
): boolean {
  if (sending) return false;
  return phase === 'idle' || phase === 'retryable';
}

export function pickLatestSignatureJob<
  T extends { status: string; createdAt?: string },
>(items: T[]): T | null {
  if (!items.length) return null;
  const active = items.find((j) => j.status === 'PENDING' || j.status === 'CLAIMED');
  return active ?? items[0] ?? null;
}
