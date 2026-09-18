import { BadRequestException } from '@nestjs/common';

/** ETA seller.syndicateLicenseNumber: persons ≥10 digit (zero-padded); companies "C" or omit. */
export function normalizeSyndicateLicenseNumber(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === 'C') return 'C';
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) {
    throw new BadRequestException({
      code: 'INVALID_SYNDICATE_LICENSE',
      message:
        'Syndicate license must be "C" for a company, or a numeric license (padded to 10 digits) for a person.',
    });
  }
  if (digits.length > 30) {
    throw new BadRequestException({
      code: 'INVALID_SYNDICATE_LICENSE',
      message: 'Syndicate license must be at most 30 characters.',
    });
  }
  return digits.padStart(10, '0');
}

export function resolveSyndicateLicenseNumber(opts: {
  issuerType: string;
  tenantDefault: string | null | undefined;
  branchOverride?: string | null | undefined;
}): { value: string | null; required: boolean; missing: boolean } {
  const branch = normalizeSyndicateLicenseNumber(opts.branchOverride);
  const tenant = normalizeSyndicateLicenseNumber(opts.tenantDefault);
  const value = branch ?? tenant;
  const required = (opts.issuerType ?? 'B').toUpperCase() === 'P';
  return { value, required, missing: required && !value };
}
