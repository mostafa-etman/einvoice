import { isSyncRunStale, SYNC_STALE_MS } from './sync-lock';

describe('sync-lock', () => {
  it('treats recent RUNNING as not stale', () => {
    const now = Date.now();
    expect(
      isSyncRunStale(
        {
          id: '1',
          status: 'RUNNING',
          createdAt: new Date(now - 60_000),
          startedAt: new Date(now - 60_000),
        },
        now,
        SYNC_STALE_MS,
      ),
    ).toBe(false);
  });

  it('treats old PENDING (no startedAt) as stale', () => {
    const now = Date.now();
    expect(
      isSyncRunStale(
        {
          id: '1',
          status: 'PENDING',
          createdAt: new Date(now - SYNC_STALE_MS - 1),
          startedAt: null,
        },
        now,
        SYNC_STALE_MS,
      ),
    ).toBe(true);
  });

  it('ignores SUCCEEDED', () => {
    const now = Date.now();
    expect(
      isSyncRunStale(
        {
          id: '1',
          status: 'SUCCEEDED',
          createdAt: new Date(now - SYNC_STALE_MS * 2),
          startedAt: new Date(now - SYNC_STALE_MS * 2),
        },
        now,
        SYNC_STALE_MS,
      ),
    ).toBe(false);
  });
});
