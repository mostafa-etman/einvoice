import {
  PAGE_SIZE,
  buyerDecisionBadgeVariant,
  etaStatusBadgeVariant,
  formatIssueDate,
  isAlreadyRunningError,
  isSyncBusy,
} from './purchase-list-utils';
import { ApiError } from '@/lib/api/client';
import { lineTaxes, normalizeTax } from './purchase-tax';

describe('purchase list utils', () => {
  it('keeps the existing page size', () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it('formats issue dates as local YYYY-MM-DD', () => {
    expect(formatIssueDate(null)).toBe('—');
    expect(formatIssueDate('not-a-date')).toBe('—');
    expect(formatIssueDate('2026-01-15T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('detects stuck and in-progress sync states', () => {
    expect(isSyncBusy('PENDING')).toBe(true);
    expect(isSyncBusy('RUNNING')).toBe(true);
    expect(isSyncBusy('SUCCEEDED')).toBe(false);
    expect(isAlreadyRunningError(new Error('already running'))).toBe(false);
    const conflict = new ApiError('already running', 409);
    expect(isAlreadyRunningError(conflict)).toBe(true);
  });

  it('maps ETA and buyer-decision statuses onto semantic badges', () => {
    expect(etaStatusBadgeVariant('Valid')).toBe('valid');
    expect(etaStatusBadgeVariant('invalid')).toBe('invalid');
    expect(etaStatusBadgeVariant('Submitted')).toBe('submitted');
    expect(buyerDecisionBadgeVariant('ACCEPTED')).toBe('valid');
    expect(buyerDecisionBadgeVariant('REJECTED')).toBe('rejected');
    expect(buyerDecisionBadgeVariant('DECLINED_CANCELATION')).toBe('warning');
  });
});

describe('purchase tax helpers', () => {
  it('reads taxes from the same sources as the PDF path', () => {
    expect(
      lineTaxes({
        taxes: [{ taxType: 'T1', subType: 'V009', rate: '14', amount: '14.00' }],
      }),
    ).toEqual([{ taxType: 'T1', subType: 'V009', rate: '14', amount: '14.00' }]);
    expect(
      normalizeTax({ TaxType: 'T1', SubType: 'V009', Rate: '14', Amount: '1' }),
    ).toEqual({ taxType: 'T1', subType: 'V009', rate: '14', amount: '1' });
  });
});
