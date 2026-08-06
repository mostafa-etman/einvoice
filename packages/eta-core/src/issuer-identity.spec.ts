import {
  isIssuerNameComplete,
  resolveIssuerId,
  resolveIssuerName,
  resolveIssuerType,
} from './issuer-identity.js';

describe('issuer identity resolution', () => {
  it('uses the tenant legal name, never the branch name', () => {
    expect(resolveIssuerName('Acme Trading LLC', undefined)).toBe(
      'Acme Trading LLC',
    );
    expect(resolveIssuerName('Acme Trading LLC', '')).toBe('Acme Trading LLC');
    expect(resolveIssuerName('Acme Trading LLC', '   ')).toBe('Acme Trading LLC');
    // No silent Main fallback — empty settings stay empty so validation fails.
    expect(resolveIssuerName(null, undefined)).toBe('');
    // Explicit leftover "Main" does NOT win over settings.
    expect(resolveIssuerName('Acme Trading LLC', 'Main', 'Main')).toBe(
      'Acme Trading LLC',
    );
    expect(resolveIssuerName('', 'Main', 'Main')).toBe('');
  });

  it('keeps a non-blank per-invoice override', () => {
    expect(resolveIssuerName('Acme Trading LLC', 'Acme Branch Desk')).toBe(
      'Acme Branch Desk',
    );
  });

  it('treats the branch label as an incomplete issuer name', () => {
    expect(isIssuerNameComplete('Acme Trading LLC', 'Main')).toBe(true);
    expect(isIssuerNameComplete('Main', 'Main')).toBe(false);
    expect(isIssuerNameComplete('main', 'Main')).toBe(false);
    expect(isIssuerNameComplete('', 'Main')).toBe(false);
    expect(isIssuerNameComplete(null)).toBe(false);
  });

  it('resolves registration number and type with the same blank-safe pattern', () => {
    expect(resolveIssuerId('123456789', '')).toBe('123456789');
    expect(resolveIssuerId('123456789', '999')).toBe('999');
    expect(resolveIssuerType('P', '')).toBe('P');
    expect(resolveIssuerType(null, 'f')).toBe('F');
    expect(resolveIssuerType(null, null)).toBe('B');
  });
});
