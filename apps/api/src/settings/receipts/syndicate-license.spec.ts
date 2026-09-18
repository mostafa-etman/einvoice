import { BadRequestException } from '@nestjs/common';
import {
  normalizeSyndicateLicenseNumber,
  resolveSyndicateLicenseNumber,
} from './syndicate-license';

describe('normalizeSyndicateLicenseNumber', () => {
  it('returns null for blank', () => {
    expect(normalizeSyndicateLicenseNumber(null)).toBeNull();
    expect(normalizeSyndicateLicenseNumber('  ')).toBeNull();
  });

  it('normalizes company marker to C', () => {
    expect(normalizeSyndicateLicenseNumber('c')).toBe('C');
    expect(normalizeSyndicateLicenseNumber('C')).toBe('C');
  });

  it('zero-pads person licenses to 10 digits', () => {
    expect(normalizeSyndicateLicenseNumber('1234567')).toBe('0001234567');
    expect(normalizeSyndicateLicenseNumber('1234567890')).toBe('1234567890');
  });

  it('rejects non-numeric non-C values', () => {
    expect(() => normalizeSyndicateLicenseNumber('AB12')).toThrow(BadRequestException);
  });
});

describe('resolveSyndicateLicenseNumber', () => {
  it('requires a license for persons and prefers the branch override', () => {
    expect(
      resolveSyndicateLicenseNumber({
        issuerType: 'P',
        tenantDefault: '123',
        branchOverride: '99',
      }),
    ).toEqual({ value: '0000000099', required: true, missing: false });

    expect(
      resolveSyndicateLicenseNumber({
        issuerType: 'P',
        tenantDefault: null,
        branchOverride: null,
      }).missing,
    ).toBe(true);
  });

  it('does not require a license for companies', () => {
    expect(
      resolveSyndicateLicenseNumber({
        issuerType: 'B',
        tenantDefault: null,
      }),
    ).toEqual({ value: null, required: false, missing: false });
  });
});
