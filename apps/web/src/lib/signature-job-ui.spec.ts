import {
  canSendForSignature,
  pickLatestSignatureJob,
  signatureSendPhase,
} from './signature-job-ui';

describe('signatureSendPhase', () => {
  it('is idle for non-READY documents', () => {
    expect(signatureSendPhase('DRAFT', 'PENDING')).toBe('idle');
    expect(signatureSendPhase('SIGNED', 'COMPLETED')).toBe('idle');
  });

  it('waits while PENDING and signs while CLAIMED', () => {
    expect(signatureSendPhase('READY', 'PENDING')).toBe('waiting');
    expect(signatureSendPhase('READY', 'CLAIMED')).toBe('signing');
  });

  it('allows retry after FAILED or CANCELLED', () => {
    expect(signatureSendPhase('READY', 'FAILED')).toBe('retryable');
    expect(signatureSendPhase('READY', 'CANCELLED')).toBe('retryable');
    expect(canSendForSignature('retryable', false)).toBe(true);
  });

  it('disables send while waiting, signing, or in-flight', () => {
    expect(canSendForSignature('waiting', false)).toBe(false);
    expect(canSendForSignature('signing', false)).toBe(false);
    expect(canSendForSignature('idle', true)).toBe(false);
    expect(canSendForSignature('idle', false)).toBe(true);
  });

  it('prefers the active job over a cancelled history row', () => {
    const picked = pickLatestSignatureJob([
      { status: 'CANCELLED', createdAt: '2026-01-01T00:00:00.000Z' },
      { status: 'PENDING', createdAt: '2026-01-01T00:31:00.000Z' },
    ]);
    expect(picked?.status).toBe('PENDING');
  });
});
