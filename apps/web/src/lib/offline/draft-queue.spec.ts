import {
  clearTenantQueue,
  deleteOfflineDatabase,
  getDraft,
  listDraftsForTenant,
  putDraft,
  resetOfflineDbHandle,
  summarizeStatuses,
} from './draft-queue';

describe('draft-queue (T015)', () => {
  beforeEach(async () => {
    await deleteOfflineDatabase();
  });

  afterEach(async () => {
    await resetOfflineDbHandle();
  });

  it('persists and reloads a draft', async () => {
    await putDraft({
      idempotencyKey: 'key-aaaa-bbbb',
      tenantId: 'tenant-1',
      userId: 'user-1',
      baseRevision: 0,
      localRevision: 1,
      payload: { internalId: 'INV-1' },
      status: 'pending',
      updatedAt: new Date().toISOString(),
    });

    await resetOfflineDbHandle();
    const got = await getDraft('key-aaaa-bbbb');
    expect(got?.payload.internalId).toBe('INV-1');
    expect(got?.tenantId).toBe('tenant-1');
  });

  it('partitions by tenant', async () => {
    await putDraft({
      idempotencyKey: 'a',
      tenantId: 't1',
      userId: 'u',
      baseRevision: 0,
      localRevision: 1,
      payload: {},
      status: 'pending',
      updatedAt: new Date().toISOString(),
    });
    await putDraft({
      idempotencyKey: 'b',
      tenantId: 't2',
      userId: 'u',
      baseRevision: 0,
      localRevision: 1,
      payload: {},
      status: 'pending',
      updatedAt: new Date().toISOString(),
    });
    const t1 = await listDraftsForTenant('t1');
    expect(t1).toHaveLength(1);
    expect(t1[0].idempotencyKey).toBe('a');
  });
});

describe('draft-queue durability (T051)', () => {
  beforeEach(async () => {
    await deleteOfflineDatabase();
  });

  afterEach(async () => {
    await resetOfflineDbHandle();
  });

  it('survives simulated restart (re-open DB)', async () => {
    await putDraft({
      idempotencyKey: 'durable-1',
      tenantId: 't1',
      userId: 'u',
      baseRevision: 0,
      localRevision: 2,
      payload: { x: 1 },
      status: 'pending',
      updatedAt: new Date().toISOString(),
    });
    await resetOfflineDbHandle();
    const items = await listDraftsForTenant('t1');
    expect(items).toHaveLength(1);
    await clearTenantQueue('t1');
    expect(await listDraftsForTenant('t1')).toHaveLength(0);
  });
});

describe('sync-status summary (T046)', () => {
  it('counts statuses', () => {
    const summary = summarizeStatuses([
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
        status: 'conflict',
        updatedAt: '',
      },
    ]);
    expect(summary.pending).toBe(1);
    expect(summary.conflict).toBe(1);
  });
});
