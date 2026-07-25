import {
  EtaTokenCache,
  isRefreshDue,
  tokenCacheKey,
  type CachedToken,
} from './eta-token.cache';

function entry(overrides: Partial<CachedToken> = {}): CachedToken {
  return {
    accessToken: 'tok',
    expiresIn: 1000,
    obtainedAt: Date.now(),
    ...overrides,
  };
}

describe('EtaTokenCache (mocked)', () => {
  it('shapes Redis keys with tenantId and optional onbehalfof', () => {
    expect(tokenCacheKey('t1')).toBe('eta:token:t1');
    expect(tokenCacheKey('t1', 'reg-9')).toBe('eta:token:t1:reg-9');
  });

  it('marks refresh-due at >= 80% of expires_in', () => {
    const obtainedAt = 1_000_000;
    const base = entry({ obtainedAt, expiresIn: 1000 });
    expect(isRefreshDue(base, obtainedAt + 799_000)).toBe(false);
    expect(isRefreshDue(base, obtainedAt + 800_000)).toBe(true);
    expect(isRefreshDue(base, obtainedAt + 1_000_000)).toBe(true);
  });

  it('reuses cache before 80% and single-flights concurrent refresh', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
      del: async (k: string) => {
        store.delete(k);
        return 1;
      },
    };
    const cache = new EtaTokenCache(redis as never);
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return entry({
        accessToken: `fresh-${producerCalls}`,
        obtainedAt: Date.now(),
        expiresIn: 3600,
      });
    };

    const [a, b] = await Promise.all([
      cache.getOrRefresh('tenant-a', null, producer),
      cache.getOrRefresh('tenant-a', null, producer),
    ]);
    expect(producerCalls).toBe(1);
    expect(a.accessToken).toBe(b.accessToken);

    const reused = await cache.getOrRefresh('tenant-a', null, producer);
    expect(producerCalls).toBe(1);
    expect(reused.accessToken).toBe(a.accessToken);

    const stale = entry({
      accessToken: 'old',
      obtainedAt: Date.now() - 900_000,
      expiresIn: 1000,
    });
    await cache.set('tenant-a', stale, null);
    const refreshed = await cache.getOrRefresh('tenant-a', null, producer);
    expect(producerCalls).toBe(2);
    expect(refreshed.accessToken).toBe('fresh-2');
  });
});
