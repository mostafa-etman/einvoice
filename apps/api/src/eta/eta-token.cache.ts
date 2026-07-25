import Redis from 'ioredis';

export type CachedToken = {
  accessToken: string;
  expiresIn: number;
  obtainedAt: number;
  scope?: string;
  tokenType?: string;
  onBehalfOf?: string | null;
};

export function tokenCacheKey(tenantId: string, onBehalfOf?: string | null): string {
  return onBehalfOf
    ? `eta:token:${tenantId}:${onBehalfOf}`
    : `eta:token:${tenantId}`;
}

/** Refresh-due when elapsed >= 80% of expires_in or past absolute expiry. */
export function isRefreshDue(entry: CachedToken, nowMs = Date.now()): boolean {
  const elapsedSec = (nowMs - entry.obtainedAt) / 1000;
  if (elapsedSec >= entry.expiresIn) return true;
  return elapsedSec >= 0.8 * entry.expiresIn;
}

export class EtaTokenCache {
  private readonly inflight = new Map<string, Promise<CachedToken>>();

  constructor(private readonly redis: Redis) {}

  async get(
    tenantId: string,
    onBehalfOf?: string | null,
  ): Promise<CachedToken | null> {
    const key = tokenCacheKey(tenantId, onBehalfOf);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedToken;
    } catch {
      return null;
    }
  }

  async set(
    tenantId: string,
    entry: CachedToken,
    onBehalfOf?: string | null,
  ): Promise<void> {
    const key = tokenCacheKey(tenantId, onBehalfOf);
    const ttl = Math.max(1, entry.expiresIn);
    await this.redis.set(key, JSON.stringify(entry), 'EX', ttl);
  }

  async invalidate(tenantId: string, onBehalfOf?: string | null): Promise<void> {
    await this.redis.del(tokenCacheKey(tenantId, onBehalfOf));
  }

  /**
   * Single-flight: concurrent refresh for same key shares one producer.
   */
  async getOrRefresh(
    tenantId: string,
    onBehalfOf: string | null | undefined,
    producer: () => Promise<CachedToken>,
  ): Promise<CachedToken> {
    const key = tokenCacheKey(tenantId, onBehalfOf);
    const existing = await this.get(tenantId, onBehalfOf);
    if (existing && !isRefreshDue(existing)) {
      return existing;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const job = (async () => {
      try {
        const again = await this.get(tenantId, onBehalfOf);
        if (again && !isRefreshDue(again)) return again;
        const fresh = await producer();
        await this.set(tenantId, fresh, onBehalfOf);
        return fresh;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }
}
