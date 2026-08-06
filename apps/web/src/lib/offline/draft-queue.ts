/**
 * IndexedDB draft queue for offline document sync (010-offline-sync).
 * Tenant-partitioned; never stores ETA secrets or PINs.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type DraftQueueStatus =
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'failed';

export type DraftQueueItem = {
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  serverDocumentId?: string;
  baseRevision: number;
  localRevision: number;
  payload: Record<string, unknown>;
  status: DraftQueueStatus;
  lastError?: string;
  updatedAt: string;
};

interface OfflineDb extends DBSchema {
  draftQueue: {
    key: string;
    value: DraftQueueItem;
    indexes: {
      'by-tenant-status': [string, string];
      'by-updated': string;
    };
  };
}

const DB_NAME = 'einvoice-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDb>> | null = null;
let openDb: IDBPDatabase<OfflineDb> | null = null;

export function openOfflineDb(): Promise<IDBPDatabase<OfflineDb>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('draftQueue', {
          keyPath: 'idempotencyKey',
        });
        store.createIndex('by-tenant-status', ['tenantId', 'status']);
        store.createIndex('by-updated', 'updatedAt');
      },
    }).then((db) => {
      openDb = db;
      return db;
    });
  }
  return dbPromise;
}

/** Test helper: close + reset module-level DB handle. */
export async function resetOfflineDbHandle(): Promise<void> {
  if (openDb) {
    openDb.close();
    openDb = null;
  }
  dbPromise = null;
}

export async function deleteOfflineDatabase(): Promise<void> {
  await resetOfflineDbHandle();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    req.onblocked = () => resolve();
  });
}

export async function putDraft(item: DraftQueueItem): Promise<void> {
  const db = await openOfflineDb();
  await db.put('draftQueue', {
    ...item,
    updatedAt: item.updatedAt || new Date().toISOString(),
  });
}

export async function getDraft(
  idempotencyKey: string,
): Promise<DraftQueueItem | undefined> {
  const db = await openOfflineDb();
  return db.get('draftQueue', idempotencyKey);
}

export async function listDraftsForTenant(
  tenantId: string,
  status?: DraftQueueStatus,
): Promise<DraftQueueItem[]> {
  const db = await openOfflineDb();
  const all = await db.getAll('draftQueue');
  return all
    .filter((d) => d.tenantId === tenantId && (!status || d.status === status))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export async function deleteDraft(idempotencyKey: string): Promise<void> {
  const db = await openOfflineDb();
  await db.delete('draftQueue', idempotencyKey);
}

export async function countUnsynced(tenantId: string): Promise<number> {
  const items = await listDraftsForTenant(tenantId);
  return items.filter((i) => i.status !== 'synced').length;
}

export async function clearTenantQueue(tenantId: string): Promise<void> {
  const db = await openOfflineDb();
  const items = await listDraftsForTenant(tenantId);
  const tx = db.transaction('draftQueue', 'readwrite');
  await Promise.all([
    ...items.map((i) => tx.store.delete(i.idempotencyKey)),
    tx.done,
  ]);
}

export function summarizeStatuses(items: DraftQueueItem[]): Record<DraftQueueStatus, number> {
  const summary: Record<DraftQueueStatus, number> = {
    pending: 0,
    syncing: 0,
    synced: 0,
    conflict: 0,
    failed: 0,
  };
  for (const i of items) summary[i.status] += 1;
  return summary;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
