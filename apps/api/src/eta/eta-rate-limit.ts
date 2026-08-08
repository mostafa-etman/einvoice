/**
 * ETA rate-limit / pacing helpers used by sync and etaFetch.
 */

export const ETA_RATE_LIMIT_MAX_RETRIES = 6;
export const ETA_RATE_LIMIT_MESSAGE =
  'ETA rate limit — sync paused, retrying / try again later';

/** Default gap between sequential ETA calls during sync (ms). */
export const DEFAULT_ETA_SYNC_REQUEST_DELAY_MS = 250;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse Retry-After header (seconds or HTTP-date) → wait ms, or null. */
export function parseRetryAfterMs(
  header: string | null,
  nowMs = Date.now(),
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const asSec = Number(trimmed);
  if (Number.isFinite(asSec) && asSec >= 0) {
    return Math.min(Math.ceil(asSec * 1000), 120_000);
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(0, asDate - nowMs), 120_000);
  }
  return null;
}

/**
 * Exponential backoff with full jitter.
 * wait = random(0, min(maxMs, initialMs * 2^attempt))
 */
export function computeBackoffMs(
  attempt: number,
  opts?: { initialMs?: number; maxMs?: number },
): number {
  const initialMs = opts?.initialMs ?? 1000;
  const maxMs = opts?.maxMs ?? 60_000;
  const exp = Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt));
  return Math.floor(Math.random() * (exp + 1));
}

/** Resolve wait for a 429: prefer Retry-After, else jittered backoff. */
export function rateLimitWaitMs(
  res: { headers: { get(name: string): string | null } },
  attempt: number,
  opts?: { initialMs?: number; maxMs?: number },
): number {
  const fromHeader = parseRetryAfterMs(res.headers.get('Retry-After'));
  if (fromHeader != null && fromHeader > 0) {
    // Small jitter so parallel tenants don't stampede.
    return fromHeader + Math.floor(Math.random() * 250);
  }
  return Math.max(500, computeBackoffMs(attempt, opts));
}

export function isEtaRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; httpStatus?: number; message?: string };
  if (e.status === 429 || e.httpStatus === 429) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /ETA HTTP 429|rate limit|Too many requests/i.test(msg);
}

export function syncRequestDelayMs(): number {
  const raw =
    process.env.ETA_SYNC_REQUEST_DELAY_MS ??
    process.env.SYNC_REQUEST_DELAY_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_ETA_SYNC_REQUEST_DELAY_MS;
}

/** Await the configured inter-request delay (sync pacing). */
export async function paceEtaSyncRequest(): Promise<void> {
  const ms = syncRequestDelayMs();
  if (ms > 0) await sleep(ms);
}
