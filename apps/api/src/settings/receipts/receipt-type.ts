import { BadRequestException } from '@nestjs/common';
import {
  normalizeReceiptType,
  type ReceiptType,
} from '@einvoice/eta-core';

export function parseReceiptType(value: string | null | undefined): ReceiptType {
  try {
    return normalizeReceiptType(value ?? '');
  } catch {
    throw new BadRequestException({
      code: 'INVALID_RECEIPT_TYPE',
      message:
        'receiptType must be s (sale), r (return), or SR (retail). Choose the type that matches this activity — it is not the same for every company.',
    });
  }
}

export function parseOptionalReceiptType(
  value: string | null | undefined,
): ReceiptType | null {
  if (value == null || !String(value).trim()) return null;
  return parseReceiptType(value);
}

/** Requested type wins; otherwise the branch override, then the tenant default. */
export function resolveReceiptType(opts: {
  requested?: string | null;
  branchDefault?: string | null;
  tenantDefault?: string | null;
}): ReceiptType {
  if (opts.requested?.trim()) return parseReceiptType(opts.requested);
  if (opts.branchDefault?.trim()) return parseReceiptType(opts.branchDefault);
  if (opts.tenantDefault?.trim()) return parseReceiptType(opts.tenantDefault);
  throw new BadRequestException({
    code: 'RECEIPT_TYPE_REQUIRED',
    message:
      'Choose a receipt type (s, r, or SR) in Settings. The platform does not pick one receipt type for every tenant.',
  });
}
