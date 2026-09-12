import {
  computeBackoffMs,
  ETA_RATE_LIMIT_MAX_RETRIES,
  ETA_RATE_LIMIT_MESSAGE,
  parseRetryAfterMs,
  rateLimitWaitMs,
  sleep,
} from './eta-rate-limit';

export type EtaHttpFetch = typeof fetch;

const SERVER_BACKOFF_MS = [200, 800, 2000];

/** Per-request ETA HTTP timeout. Previous: none (Node fetch could hang until undici defaults). */
export const DEFAULT_ETA_HTTP_TIMEOUT_MS = 45_000;

export function etaHttpTimeoutMs(): number {
  const raw = process.env.ETA_HTTP_TIMEOUT_MS;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_ETA_HTTP_TIMEOUT_MS;
}

function isAbortOrTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return (
    e.name === 'TimeoutError' ||
    e.name === 'AbortError' ||
    e.code === 'ABORT_ERR'
  );
}

function mergeAbortSignal(
  existing: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  if (timeoutMs <= 0) return existing;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!existing) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([existing, timeoutSignal]);
  }
  return timeoutSignal;
}

function backoffEnv() {
  const initial = Number(process.env.SYNC_BACKOFF_INITIAL_MS);
  const max = Number(process.env.SYNC_BACKOFF_MAX_MS);
  return {
    initialMs: Number.isFinite(initial) && initial > 0 ? initial : 1000,
    maxMs: Number.isFinite(max) && max > 0 ? max : 60_000,
  };
}

/**
 * Fetch with retries for transient ETA failures:
 * - 5xx / network: short fixed backoff
 * - 429: Retry-After when present, else exponential backoff + jitter
 */
export async function etaFetch(
  input: string,
  init: RequestInit,
  fetchImpl: EtaHttpFetch = fetch,
): Promise<Response> {
  const { initialMs, maxMs } = backoffEnv();
  let lastError: unknown;
  let rateAttempts = 0;
  let serverAttempts = 0;
  const maxAttempts =
    ETA_RATE_LIMIT_MAX_RETRIES + SERVER_BACKOFF_MS.length + 1;

  const timeoutMs = etaHttpTimeoutMs();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(input, {
        ...init,
        signal: mergeAbortSignal(init.signal ?? undefined, timeoutMs),
      });

      if (res.status === 429) {
        if (rateAttempts >= ETA_RATE_LIMIT_MAX_RETRIES) {
          return res;
        }
        const wait = rateLimitWaitMs(res, rateAttempts, { initialMs, maxMs });
        rateAttempts += 1;
        await sleep(wait);
        continue;
      }

      if (res.status >= 500 && serverAttempts < SERVER_BACKOFF_MS.length) {
        await sleep(SERVER_BACKOFF_MS[serverAttempts]!);
        serverAttempts += 1;
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (isAbortOrTimeout(err)) break;
      if (serverAttempts >= SERVER_BACKOFF_MS.length) break;
      await sleep(SERVER_BACKOFF_MS[serverAttempts]!);
      serverAttempts += 1;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('ETA request failed after retries');
}

export {
  computeBackoffMs,
  ETA_RATE_LIMIT_MAX_RETRIES,
  ETA_RATE_LIMIT_MESSAGE,
  parseRetryAfterMs,
  rateLimitWaitMs,
  sleep,
};
