import { ApiError } from '@/lib/api/client';
import type { BadgeVariant } from '@/components/ui/badge';

export const PAGE_SIZE = 50;

export type SortBy =
  | 'dateTimeIssued'
  | 'totalAmount'
  | 'internalId'
  | 'issuerName'
  | 'lastSyncedAt';

export const KIND_FILTERS = [
  'PURCHASE_INVOICE',
  'PURCHASE_RETURN',
  'OTHER_RECEIVED',
] as const;

export const ETA_STATUS_FILTERS = [
  { value: 'Valid', labelKey: 'etaStatusValid' },
  { value: 'Invalid', labelKey: 'etaStatusInvalid' },
  { value: 'Rejected', labelKey: 'etaStatusRejected' },
  { value: 'Cancelled', labelKey: 'etaStatusCancelled' },
  { value: 'Submitted', labelKey: 'etaStatusSubmitted' },
] as const;

export function formatIssueDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSyncBusy(status: string | null | undefined) {
  return status === 'PENDING' || status === 'RUNNING';
}

export function isAlreadyRunningError(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 409) return false;
  const msg = e.message.toLowerCase();
  return msg.includes('already running') || msg.includes('in progress');
}

export function etaStatusBadgeVariant(status: string | null | undefined): BadgeVariant {
  switch (String(status ?? '').toLowerCase()) {
    case 'valid':
      return 'valid';
    case 'invalid':
      return 'invalid';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'submitted':
      return 'submitted';
    default:
      return 'neutral';
  }
}

export function buyerDecisionBadgeVariant(decision: string | null | undefined): BadgeVariant {
  switch (String(decision ?? '')) {
    case 'ACCEPTED':
      return 'valid';
    case 'REJECTED':
      return 'rejected';
    case 'DECLINED_CANCELATION':
      return 'warning';
    default:
      return 'neutral';
  }
}
