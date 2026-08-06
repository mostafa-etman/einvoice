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
    clientId: 'client-a',
    ...overrides,
  };
}

const identity = {
  tenantId: 'tenant-a',
  clientId: 'client-a',
  onBehalfOf: null as string | null,
  environment: 'SANDBOX',
};

describe('EtaTokenCache (mocked)', () => {
  it('shapes Redis keys with tenantId, clientId, and optional onbehalfof', () => {
    expect(tokenCacheKey('t1')).toBe('eta:token:t1:SANDBOX:_:_');
    expect(tokenCacheKey('t1', { clientId: 'cid' })).toBe(
      'eta:token:t1:SANDBOX:cid:_',
    );
    expect(
      tokenCacheKey('t1', { clientId: 'cid', onBehalfOf: 'reg-9' }),
    ).toBe('eta:token:t1:SANDBOX:cid:reg-9');
    expect(
      tokenCacheKey('t1', {
        clientId: 'cid',
        environment: 'PRODUCTION',
      }),
    ).toBe('eta:token:t1:PRODUCTION:cid:_');
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

    // 50 concurrent callers — one /connect/token, not 50.
    const many = await Promise.all(
      Array.from({ length: 50 }, () => cache.getOrRefresh(identity, producer)),
    );
    expect(producerCalls).toBe(1);
    expect(new Set(many.map((t) => t.accessToken)).size).toBe(1);

    const reused = await cache.getOrRefresh(identity, producer);
    expect(producerCalls).toBe(1);
    expect(reused.accessToken).toBe(many[0]!.accessToken);

    const stale = entry({
      accessToken: 'old',
      obtainedAt: Date.now() - 900_000,
      expiresIn: 1000,
    });
    await cache.set(identity, stale);
    const refreshed = await cache.getOrRefresh(identity, producer);
    expect(producerCalls).toBe(2);
    expect(refreshed.accessToken).toBe('fresh-2');
  });

  it('keeps separate cache slots for different OAuth clientIds', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
      del: async () => 1,
    };
    const cache = new EtaTokenCache(redis as never);
    let calls = 0;
    const producerFor = (clientId: string) => async () => {
      calls += 1;
      return entry({
        clientId,
        accessToken: `tok-${clientId}`,
        obtainedAt: Date.now(),
        expiresIn: 3600,
      });
    };

    const a = await cache.getOrRefresh(
      {
        tenantId: 't',
        clientId: 'client-a',
        onBehalfOf: null,
        environment: 'SANDBOX',
      },
      producerFor('client-a'),
    );
    const b = await cache.getOrRefresh(
      {
        tenantId: 't',
        clientId: 'client-b',
        onBehalfOf: null,
        environment: 'SANDBOX',
      },
      producerFor('client-b'),
    );
    expect(calls).toBe(2);
    expect(a.accessToken).toBe('tok-client-a');
    expect(b.accessToken).toBe('tok-client-b');
  });
});
