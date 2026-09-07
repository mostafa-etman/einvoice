import { isTerminalLocalStatus, mapEtaStatusToLocal, shouldApplyMappedEtaStatus } from './eta-status-map';

describe('eta-status-map (T010)', () => {
  it('maps Valid / Invalid / Cancelled / Rejected', () => {
    expect(mapEtaStatusToLocal('Valid')).toBe('VALID');
    expect(mapEtaStatusToLocal('Invalid')).toBe('INVALID');
    expect(mapEtaStatusToLocal('Cancelled')).toBe('CANCELLED');
    expect(mapEtaStatusToLocal('Canceled')).toBe('CANCELLED');
    expect(mapEtaStatusToLocal('Rejected')).toBe('REJECTED');
  });

  it('maps Submitted / New to SUBMITTED', () => {
    expect(mapEtaStatusToLocal('Submitted')).toBe('SUBMITTED');
    expect(mapEtaStatusToLocal('New')).toBe('SUBMITTED');
  });

  it('maps cancelled aliases including taxpayer wording', () => {
    expect(mapEtaStatusToLocal('Cancelled by taxpayer')).toBe('CANCELLED');
    expect(mapEtaStatusToLocal('ملغاة')).toBe('CANCELLED');
  });

  it('does not treat cancel-request-only wording as Cancelled', () => {
    expect(mapEtaStatusToLocal('Cancel request')).toBeNull();
  });

  it('returns null for unknown status', () => {
    expect(mapEtaStatusToLocal('SomethingElse')).toBeNull();
    expect(mapEtaStatusToLocal('')).toBeNull();
    expect(mapEtaStatusToLocal(null)).toBeNull();
  });

  it('identifies terminal local statuses', () => {
    expect(isTerminalLocalStatus('VALID')).toBe(true);
    expect(isTerminalLocalStatus('INVALID')).toBe(true);
    expect(isTerminalLocalStatus('CANCELLED')).toBe(true);
    expect(isTerminalLocalStatus('REJECTED')).toBe(true);
    expect(isTerminalLocalStatus('SUBMITTED')).toBe(false);
    expect(isTerminalLocalStatus('SIGNED')).toBe(false);
  });

  it('does not apply Valid over Cancelled/Rejected', () => {
    expect(shouldApplyMappedEtaStatus('CANCELLED', 'VALID')).toBe(false);
    expect(shouldApplyMappedEtaStatus('REJECTED', 'VALID')).toBe(false);
    expect(shouldApplyMappedEtaStatus('VALID', 'CANCELLED')).toBe(true);
    expect(shouldApplyMappedEtaStatus('CANCELLED', 'CANCELLED')).toBe(true);
  });
});
