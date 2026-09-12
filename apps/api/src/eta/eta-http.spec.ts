import { etaFetch } from './eta-http';

describe('etaFetch rate-limit retries', () => {
  it('retries 429 using Retry-After then returns success', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('Too many requests', {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const res = await etaFetch(
      'https://eta.test/x',
      { method: 'GET' },
      fetchImpl,
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('returns final 429 after retry budget is exhausted', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }) as typeof fetch;

    const res = await etaFetch(
      'https://eta.test/x',
      { method: 'GET' },
      fetchImpl,
    );
    expect(res.status).toBe(429);
    expect(calls).toBeGreaterThan(1);
  });

  it('attaches a per-request abort signal (ETA_HTTP_TIMEOUT_MS)', async () => {
    const orig = process.env.ETA_HTTP_TIMEOUT_MS;
    process.env.ETA_HTTP_TIMEOUT_MS = '45000';
    try {
      let seen: AbortSignal | undefined;
      const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;
      await etaFetch('https://eta.test/x', { method: 'GET' }, fetchImpl);
      expect(seen).toBeDefined();
      expect(seen?.aborted).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.ETA_HTTP_TIMEOUT_MS;
      else process.env.ETA_HTTP_TIMEOUT_MS = orig;
    }
  });
});
