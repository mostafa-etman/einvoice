import { missingIssuerAddressFields, type IssuerAddress } from '@einvoice/eta-core';
import { resolveSyndicateLicenseNumber } from './syndicate-license';

export const RECEIPT_BRANCH_GAPS = [
  'MISSING_ETA_BRANCH_CODE',
  'MISSING_ACTIVITY_CODE',
  'INCOMPLETE_ADDRESS',
  'MISSING_SYNDICATE_LICENSE',
] as const;

export type ReceiptBranchGap = (typeof RECEIPT_BRANCH_GAPS)[number];

export type ReceiptBranchInput = {
  receiptsEnabled: boolean;
  etaBranchCode?: string | null;
  activityCode?: string | null;
  address?: IssuerAddress | null;
  issuerType: string;
  tenantSyndicateLicense?: string | null;
  branchSyndicateLicense?: string | null;
};

export function receiptBranchGaps(input: ReceiptBranchInput): ReceiptBranchGap[] {
  if (!input.receiptsEnabled) return [];
  const gaps: ReceiptBranchGap[] = [];
  if (!input.etaBranchCode?.trim()) gaps.push('MISSING_ETA_BRANCH_CODE');
  if (!input.activityCode?.trim()) gaps.push('MISSING_ACTIVITY_CODE');
  if (missingIssuerAddressFields(input.address).length) {
    gaps.push('INCOMPLETE_ADDRESS');
  }
  const syndicate = resolveSyndicateLicenseNumber({
    issuerType: input.issuerType,
    tenantDefault: input.tenantSyndicateLicense,
    branchOverride: input.branchSyndicateLicense,
  });
  if (syndicate.missing) gaps.push('MISSING_SYNDICATE_LICENSE');
  return gaps;
}

export function isReceiptBranchReady(input: ReceiptBranchInput): boolean {
  return receiptBranchGaps(input).length === 0;
}
