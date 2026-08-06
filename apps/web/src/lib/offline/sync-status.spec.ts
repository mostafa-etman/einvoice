import { summarizeStatuses, type DraftQueueItem } from './draft-queue';

describe('sync-status (T046)', () => {
  it('summarizes queue status counts', () => {
    const items: DraftQueueItem[] = [
      {
        idempotencyKey: '1',
        tenantId: 't',
        userId: 'u',
        baseRevision: 0,
        localRevision: 1,
        payload: {},
        status: 'pending',
        updatedAt: '',
      },
      {
        idempotencyKey: '2',
        tenantId: 't',
        userId: 'u',
        baseRevision: 0,
        localRevision: 1,
        payload: {},
        status: 'synced',
        updatedAt: '',
      },
      {
        idempotencyKey: '3',
        tenantId: 't',
        userId: 'u',
        baseRevision: 0,
        localRevision: 1,
        payload: {},
        status: 'failed',
        updatedAt: '',
      },
    ];
    expect(summarizeStatuses(items)).toEqual({
      pending: 1,
      syncing: 0,
      synced: 1,
      conflict: 0,
      failed: 1,
    });
  });
});
