import { mapPool, etaSyncDetailsConcurrency } from './async-pool';

describe('mapPool', () => {
  it('caps in-flight work and preserves index order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await mapPool(items, 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(out).toEqual(items.map((n) => n * 2));
  });
});

describe('etaSyncDetailsConcurrency', () => {
  const orig = process.env.ETA_SYNC_DETAILS_CONCURRENCY;
  afterEach(() => {
    if (orig === undefined) delete process.env.ETA_SYNC_DETAILS_CONCURRENCY;
    else process.env.ETA_SYNC_DETAILS_CONCURRENCY = orig;
  });

  it('defaults to 6 and clamps to 1–10', () => {
    delete process.env.ETA_SYNC_DETAILS_CONCURRENCY;
    expect(etaSyncDetailsConcurrency()).toBe(6);
    process.env.ETA_SYNC_DETAILS_CONCURRENCY = '99';
    expect(etaSyncDetailsConcurrency()).toBe(10);
    process.env.ETA_SYNC_DETAILS_CONCURRENCY = '0';
    expect(etaSyncDetailsConcurrency()).toBe(1);
  });
});
