import { isTerminalLocalStatus, mapEtaStatusToLocal } from './eta-status-map';

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
});
