import type { BadgeVariant } from '@/components/ui/badge';

export const AUTO_POLL_MS = 5_000;
export const PAGE_SIZE = 50;

/** Previous UI wait: 90 × 1s. Large ETA pulls stay RUNNING longer than 90s. */
export const SALES_SYNC_POLL_INTERVAL_MS = 2_000;
export const SALES_SYNC_POLL_ATTEMPTS = 300;

export type SortBy =
  | 'issueDateTime'
  | 'totalAmount'
  | 'internalId'
  | 'receiverName';

export const STATUS_FILTERS = [
  'DRAFT',
  'READY',
  'PENDING_SIGNATURE',
  'SIGNED',
  'SUBMITTED',
  'VALID',
  'INVALID',
  'CANCELLED',
  'REJECTED',
] as const;

export const KIND_FILTERS = [
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'EXPORT_INVOICE',
  'EXPORT_CREDIT_NOTE',
  'EXPORT_DEBIT_NOTE',
] as const;

export function isSigned(status: string) {
  return status === 'SIGNED';
}

export function isPendingEta(status: string, etaUuid?: string | null) {
  return status === 'SUBMITTED' || (Boolean(etaUuid) && status === 'SUBMITTED');
}

export function canCancel(status: string, etaUuid?: string | null) {
  return Boolean(etaUuid) && (status === 'VALID' || status === 'SUBMITTED');
}

export function canDownloadEta(status: string, etaUuid?: string | null) {
  return (
    Boolean(etaUuid) &&
    (status === 'VALID' ||
      status === 'INVALID' ||
      status === 'SUBMITTED' ||
      status === 'CANCELLED' ||
      status === 'REJECTED')
  );
}

export function formatIssueDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function documentBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'SIGNED':
      return 'signed';
    case 'SUBMITTED':
      return 'submitted';
    case 'VALID':
      return 'valid';
    case 'INVALID':
      return 'invalid';
    case 'CANCELLED':
      return 'cancelled';
    case 'REJECTED':
      return 'rejected';
    case 'READY':
    case 'PENDING_SIGNATURE':
      return 'warning';
    case 'DRAFT':
      return 'draft';
    default:
      return 'neutral';
  }
}
