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

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(input, init);

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
