import Redis from 'ioredis';

export type CachedToken = {
  accessToken: string;
  expiresIn: number;
  obtainedAt: number;
  scope?: string;
  tokenType?: string;
  onBehalfOf?: string | null;
  /** Distinguishes tenant-wide vs branch-override OAuth clients. */
  clientId?: string;
};

/**
 * Cache key: one slot per OAuth client identity + ETA environment.
 * - Sandbox and production tokens never share a Redis slot.
 * - Branch credential overrides that use a different clientId get their own slot.
 */
export function tokenCacheKey(
  tenantId: string,
  opts?: {
    onBehalfOf?: string | null;
    clientId?: string | null;
    environment?: string | null;
  },
): string {
  const client = opts?.clientId?.trim() || '_';
  const obo = opts?.onBehalfOf?.trim() || '_';
  const env = opts?.environment?.trim() || 'SANDBOX';
  return `eta:token:${tenantId}:${env}:${client}:${obo}`;
}

/** Refresh-due when elapsed >= 80% of expires_in or past absolute expiry. */
export function isRefreshDue(entry: CachedToken, nowMs = Date.now()): boolean {
  const elapsedSec = (nowMs - entry.obtainedAt) / 1000;
  if (elapsedSec >= entry.expiresIn) return true;
  return elapsedSec >= 0.8 * entry.expiresIn;
}

export type TokenCacheIdentity = {
  tenantId: string;
  clientId: string;
  onBehalfOf?: string | null;
  /** SANDBOX | PRODUCTION — required so hosts never share tokens. */
  environment: string;
};

export class EtaTokenCache {
  /** In-process single-flight so concurrent callers share one /connect/token. */
  private readonly inflight = new Map<string, Promise<CachedToken>>();

  constructor(private readonly redis: Redis) {}

  async get(identity: TokenCacheIdentity): Promise<CachedToken | null> {
    const key = tokenCacheKey(identity.tenantId, identity);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedToken;
    } catch {
      return null;
    }
  }

  async set(identity: TokenCacheIdentity, entry: CachedToken): Promise<void> {
    const key = tokenCacheKey(identity.tenantId, identity);
    const ttl = Math.max(1, entry.expiresIn);
    await this.redis.set(key, JSON.stringify(entry), 'EX', ttl);
  }

  async invalidate(identity: TokenCacheIdentity): Promise<void> {
    await this.redis.del(tokenCacheKey(identity.tenantId, identity));
  }

  /**
   * Single-flight: concurrent refresh for the same key shares one producer.
   * Returns the cached token when still within the 80% lifetime window.
   */
  async getOrRefresh(
    identity: TokenCacheIdentity,
    producer: () => Promise<CachedToken>,
  ): Promise<CachedToken> {
    const key = tokenCacheKey(identity.tenantId, identity);
    const existing = await this.get(identity);
    if (existing && !isRefreshDue(existing)) {
      return existing;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const job = (async () => {
      try {
        // Double-check after winning the flight — another worker may have filled Redis.
        const again = await this.get(identity);
        if (again && !isRefreshDue(again)) return again;
        const fresh = await producer();
        await this.set(identity, fresh);
        return fresh;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }
}
