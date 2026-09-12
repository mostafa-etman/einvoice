/**
 * Shared ETA search collection for sales + purchases sync.
 * Completeness: walk every window from the range start, retry 429s, do not
 * silently drop the beginning of the requested period.
 */

import { buildEtaSearchWindows } from '../eta/eta-documents-search.client';
import {
  computeBackoffMs,
  ETA_RATE_LIMIT_MESSAGE,
  isEtaRateLimitError,
  paceEtaSyncRequest,
  sleep,
} from '../eta/eta-rate-limit';
import { MAX_SYNC_WINDOWS } from './sync-range';

export const ETA_SYNC_PAGE_MAX_RETRIES = 12;

/** VAT / C4 periods are issue-date based — search must use the same field. */
export const ETA_SYNC_DATE_FIELD = 'issue' as const;

export function syncSearchWindows(
  from: Date,
  to: Date,
): Array<{ from: Date; to: Date }> {
  const windows = buildEtaSearchWindows(from, to);
  if (windows.length <= MAX_SYNC_WINDOWS) return windows;
  // Keep the requested start (beginning of the VAT/sync period), not the tail.
  return windows.slice(0, MAX_SYNC_WINDOWS);
}

export function etaSearchRowUuid(row: Record<string, unknown>): string {
  return String(
    row.uuid ??
      row.UUID ??
      row.documentUUID ??
      row.documentUuid ??
      '',
  ).trim();
}

export async function retryOnEtaRateLimit<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const max = opts?.maxRetries ?? ETA_SYNC_PAGE_MAX_RETRIES;
  const wait = opts?.sleepFn ?? sleep;
  let last: unknown;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      if (attempt === 0) await paceEtaSyncRequest();
      return await fn();
    } catch (err) {
      last = err;
      if (!isEtaRateLimitError(err) || attempt >= max) throw err;
      await wait(
        computeBackoffMs(attempt, { initialMs: 1500, maxMs: 30_000 }),
      );
    }
  }
  throw last instanceof Error ? last : new Error(ETA_RATE_LIMIT_MESSAGE);
}

export async function collectEtaSearchRows(opts: {
  windows: Array<{ from: Date; to: Date }>;
  searchPage: (args: {
    continuationToken?: string;
    window: { from: Date; to: Date };
  }) => Promise<{
    result: Record<string, unknown>[];
    continuationToken?: string | null;
  }>;
  uuidOf?: (row: Record<string, unknown>) => string;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<{
  byUuid: Map<string, Record<string, unknown>>;
  skippedCount: number;
  searchIncomplete: boolean;
  errors: string[];
}> {
  const uuidOf = opts.uuidOf ?? etaSearchRowUuid;
  const byUuid = new Map<string, Record<string, unknown>>();
  let skippedCount = 0;
  const errors: string[] = [];
  let searchIncomplete = false;

  for (const win of opts.windows) {
    let token: string | null | undefined;
    let previousToken: string | undefined;
    try {
      do {
        const page = await retryOnEtaRateLimit(
          () =>
            opts.searchPage({
              continuationToken: token || undefined,
              window: win,
            }),
          { sleepFn: opts.sleepFn },
        );
        for (const row of page.result) {
          const uuid = uuidOf(row);
          if (!uuid) {
            skippedCount += 1;
            continue;
          }
          byUuid.set(uuid, row);
        }
        previousToken = token || undefined;
        token = page.continuationToken;
        if (token && token === previousToken) {
          searchIncomplete = true;
          errors.push('ETA search continuation token did not advance');
          break;
        }
      } while (token);
    } catch (err) {
      if (isEtaRateLimitError(err)) {
        searchIncomplete = true;
        errors.push(ETA_RATE_LIMIT_MESSAGE);
        break;
      }
      throw err;
    }
  }

  return { byUuid, skippedCount, searchIncomplete, errors };
}
