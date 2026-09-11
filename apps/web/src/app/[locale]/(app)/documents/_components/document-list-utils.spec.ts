import {
  AUTO_POLL_MS,
  PAGE_SIZE,
  canCancel,
  canDownloadEta,
  documentBadgeVariant,
  formatIssueDate,
  isPendingEta,
  isSigned,
} from './document-list-utils';

describe('document list utils', () => {
  it('keeps the existing auto-poll interval', () => {
    expect(AUTO_POLL_MS).toBe(5_000);
    expect(PAGE_SIZE).toBe(50);
  });

  it('formats issue dates as local YYYY-MM-DD', () => {
    expect(formatIssueDate(null)).toBe('—');
    expect(formatIssueDate('not-a-date')).toBe('—');
    expect(formatIssueDate('2026-01-15T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('preserves status helpers used by row and bulk actions', () => {
    expect(isSigned('SIGNED')).toBe(true);
    expect(isSigned('VALID')).toBe(false);
    expect(isPendingEta('SUBMITTED', null)).toBe(true);
    expect(isPendingEta('VALID', 'uuid')).toBe(false);
    expect(canCancel('VALID', 'uuid')).toBe(true);
    expect(canCancel('VALID', null)).toBe(false);
    expect(canDownloadEta('INVALID', 'uuid')).toBe(true);
    expect(canDownloadEta('DRAFT', 'uuid')).toBe(false);
  });

  it('maps ETA statuses onto semantic badge variants', () => {
    expect(documentBadgeVariant('VALID')).toBe('valid');
    expect(documentBadgeVariant('INVALID')).toBe('invalid');
    expect(documentBadgeVariant('REJECTED')).toBe('rejected');
    expect(documentBadgeVariant('CANCELLED')).toBe('cancelled');
    expect(documentBadgeVariant('SUBMITTED')).toBe('submitted');
    expect(documentBadgeVariant('SIGNED')).toBe('signed');
    expect(documentBadgeVariant('DRAFT')).toBe('draft');
    expect(documentBadgeVariant('READY')).toBe('warning');
    expect(documentBadgeVariant('PENDING_SIGNATURE')).toBe('warning');
  });
});
