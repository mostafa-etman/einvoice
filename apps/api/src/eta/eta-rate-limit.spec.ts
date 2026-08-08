import {
  computeBackoffMs,
  ETA_RATE_LIMIT_MAX_RETRIES,
  isEtaRateLimitError,
  parseRetryAfterMs,
  rateLimitWaitMs,
  syncRequestDelayMs,
} from './eta-rate-limit';

describe('eta-rate-limit', () => {
  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses Retry-After HTTP-date', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(1000);
    expect(ms!).toBeLessThanOrEqual(120_000);
  });

  it('computeBackoffMs stays within cap', () => {
    for (let i = 0; i < 20; i++) {
      const ms = computeBackoffMs(i, { initialMs: 1000, maxMs: 8000 });
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(8000);
    }
  });

  it('rateLimitWaitMs prefers Retry-After', () => {
    const res = {
      headers: { get: (n: string) => (n === 'Retry-After' ? '2' : null) },
    };
    const wait = rateLimitWaitMs(res, 0, { initialMs: 1000, maxMs: 60_000 });
    expect(wait).toBeGreaterThanOrEqual(2000);
    expect(wait).toBeLessThan(2000 + 250);
  });

  it('detects rate-limit errors', () => {
    expect(isEtaRateLimitError({ status: 429, message: 'x' })).toBe(true);
    expect(
      isEtaRateLimitError(new Error('ETA HTTP 429: Too many requests')),
    ).toBe(true);
    expect(isEtaRateLimitError(new Error('ETA HTTP 500'))).toBe(false);
  });

  it('exposes retry budget', () => {
    expect(ETA_RATE_LIMIT_MAX_RETRIES).toBeGreaterThanOrEqual(3);
    expect(syncRequestDelayMs()).toBeGreaterThanOrEqual(0);
  });
});
