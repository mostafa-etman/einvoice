/**
 * Shared stale-lock helpers for ETA sync runs (sales + purchases).
 * A crashed process can leave PENDING/RUNNING rows forever; age them out.
 */

/**
 * Default: 60 minutes.
 * Previous: 30 minutes — first-time sync of thousands of invoices (sequential
 * details + 250ms pacing) exceeded that and the lock was released as "timed out"
 * while work was still running. Speed-up is the primary fix; this is a margin.
 */
export const SYNC_STALE_MS = 60 * 60 * 1000;

export const SYNC_STALE_ERROR =
  'Sync timed out or was interrupted — lock released automatically';

export const SYNC_RESET_ERROR =
  'Sync cancelled / reset by user — lock released';

export type SyncRunBusyLike = {
  id: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
};

/** True when a PENDING/RUNNING run is older than the stale TTL. */
export function isSyncRunStale(
  run: SyncRunBusyLike,
  nowMs = Date.now(),
  staleMs = SYNC_STALE_MS,
): boolean {
  if (run.status !== 'PENDING' && run.status !== 'RUNNING') return false;
  const anchor = run.startedAt ?? run.createdAt;
  return nowMs - anchor.getTime() >= staleMs;
}
