import {
  collectEtaSearchRows,
  retryOnEtaRateLimit,
  syncSearchWindows,
} from './eta-sync-collect';
import { MAX_SYNC_WINDOWS } from './sync-range';

describe('eta-sync-collect', () => {
  const origDelay = process.env.ETA_SYNC_REQUEST_DELAY_MS;

  beforeAll(() => {
    process.env.ETA_SYNC_REQUEST_DELAY_MS = '0';
  });

  afterAll(() => {
    if (origDelay === undefined) delete process.env.ETA_SYNC_REQUEST_DELAY_MS;
    else process.env.ETA_SYNC_REQUEST_DELAY_MS = origDelay;
  });

  it('keeps the start of a long range instead of dropping oldest windows', () => {
    const from = new Date('2025-01-01T00:00:00.000Z');
    const to = new Date('2025-12-31T23:59:59.000Z');
    const windows = syncSearchWindows(from, to);
    expect(windows.length).toBeLessThanOrEqual(MAX_SYNC_WINDOWS);
    expect(windows[0]!.from.getTime()).toBe(from.getTime());
  });

  it('retries 429 then returns the successful page', async () => {
    let calls = 0;
    const result = await retryOnEtaRateLimit(
      async () => {
        calls += 1;
        if (calls < 3) {
          const err = new Error('ETA HTTP 429: Too many requests') as Error & {
            status?: number;
          };
          err.status = 429;
          throw err;
        }
        return 'ok';
      },
      { sleepFn: async () => undefined },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('collects every page across windows and does not abort after a recovered 429', async () => {
    let calls = 0;
    const { byUuid, searchIncomplete } = await collectEtaSearchRows({
      sleepFn: async () => undefined,
      windows: [
        {
          from: new Date('2026-07-01T00:00:00.000Z'),
          to: new Date('2026-07-31T00:00:00.000Z'),
        },
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-31T00:00:00.000Z'),
        },
      ],
      searchPage: async ({ window }) => {
        calls += 1;
        if (calls === 1) {
          const err = new Error('ETA HTTP 429: Too many requests') as Error & {
            status?: number;
          };
          err.status = 429;
          throw err;
        }
        const month = window.from.toISOString().slice(5, 7);
        return {
          result: [{ uuid: `u-${month}` }],
          continuationToken: null,
        };
      },
    });
    expect(searchIncomplete).toBe(false);
    expect([...byUuid.keys()].sort()).toEqual(['u-07', 'u-08']);
  });

  it('walks continuation tokens until all same-day pages are collected (250 / pageSize 100)', async () => {
    const PAGE = 100;
    const TOTAL = 250;
    const all = Array.from({ length: TOTAL }, (_, i) => ({
      uuid: `uuid-${String(i + 1).padStart(3, '0')}`,
      dateTimeIssued: '2026-09-12T12:00:00Z',
    }));
    const tokensSeen: Array<string | undefined> = [];
    const { byUuid, searchIncomplete } = await collectEtaSearchRows({
      sleepFn: async () => undefined,
      windows: [
        {
          from: new Date('2026-09-11T22:00:00.000Z'),
          to: new Date('2026-09-12T21:59:59.999Z'),
        },
      ],
      searchPage: async ({ continuationToken }) => {
        tokensSeen.push(continuationToken);
        const start =
          continuationToken === 'p2' ? 100 : continuationToken === 'p3' ? 200 : 0;
        const slice = all.slice(start, start + PAGE);
        const next =
          start + PAGE < TOTAL ? (start === 0 ? 'p2' : 'p3') : null;
        return { result: slice, continuationToken: next };
      },
    });
    expect(searchIncomplete).toBe(false);
    expect(tokensSeen).toEqual([undefined, 'p2', 'p3']);
    expect(byUuid.size).toBe(TOTAL);
    expect([...byUuid.keys()]).toEqual(all.map((r) => r.uuid));
  });
});
