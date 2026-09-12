/**
 * Shared sync date-range resolution for sales + purchases ETA pulls.
 * Calendar days follow Africa/Cairo (same as local export / C4).
 */

import { parseCairoBoundedInstant } from '../time/cairo-day';

export type SyncDateRangeInput = {
  from?: string | Date | null;
  to?: string | Date | null;
};

export type SyncDateRange = { from: Date; to: Date };

/** Cap windows so a single run cannot hammer ETA (≈ 30d each). */
export const MAX_SYNC_WINDOWS = 12;

/** Safer default lookback when the user does not pick a range (days). */
export const DEFAULT_SYNC_LOOKBACK_DAYS = 90;

function parseBound(
  value: string | Date | null | undefined,
  role: 'from' | 'to',
  fallback: Date,
): Date {
  const parsed = parseCairoBoundedInstant(value ?? undefined, role);
  if (!parsed) {
    if (value != null && String(value).trim()) {
      throw new Error('Invalid sync date range');
    }
    return fallback;
  }
  return parsed;
}

export function parseSyncDateRange(
  input: SyncDateRangeInput | undefined,
  fallback: SyncDateRange,
): SyncDateRange {
  if (!input?.from && !input?.to) return fallback;

  const to = parseBound(input.to, 'to', fallback.to);
  const from = parseBound(input.from, 'from', fallback.from);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('Invalid sync date range');
  }
  if (from.getTime() > to.getTime()) {
    throw new Error('Sync date range: from must be before to');
  }

  const maxSpanMs = MAX_SYNC_WINDOWS * 30 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxSpanMs) {
    throw new Error(
      `Sync date range too large (max ~${MAX_SYNC_WINDOWS * 30} days). Pick a smaller window.`,
    );
  }
  return { from, to };
}

export function defaultLookbackRange(lookbackDays: number): SyncDateRange {
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return { from, to };
}
