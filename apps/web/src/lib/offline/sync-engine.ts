/**
 * Sync engine: online detect, drain IndexedDB queue, exponential backoff.
 */
import {
  getDraft,
  listDraftsForTenant,
  putDraft,
  type DraftQueueItem,
  type DraftQueueStatus,
} from './draft-queue';
import {
  resolveSyncConflict,
  syncDraft,
  type DraftSyncBody,
  type SyncConflictPayload,
} from '@/lib/api/sync';
import { ApiError } from '@/lib/api/client';

export type SyncEngineOptions = {
  tenantId: string;
  userId: string;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  isOnline?: () => boolean;
  onStatus?: (item: DraftQueueItem) => void;
  onConflict?: (conflict: SyncConflictPayload, item: DraftQueueItem) => void;
};

export function nextBackoffMs(
  attempt: number,
  initialMs = 1000,
  maxMs = 60_000,
): number {
  const exp = Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt));
  return Math.min(maxMs, exp);
}

export class SyncEngine {
  private running = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<
    Pick<SyncEngineOptions, 'tenantId' | 'userId' | 'initialBackoffMs' | 'maxBackoffMs' | 'isOnline'>
  > &
    SyncEngineOptions;

  constructor(opts: SyncEngineOptions) {
    this.opts = {
      initialBackoffMs: 1000,
      maxBackoffMs: 60_000,
      isOnline: () =>
        typeof navigator === 'undefined' ? true : navigator.onLine,
      ...opts,
    };
  }

  start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }
    void this.drain();
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
  }

  private onOnline = () => {
    this.attempt = 0;
    void this.drain();
  };

  async drain(): Promise<void> {
    if (this.running) return;
    if (!this.opts.isOnline()) {
      this.scheduleRetry();
      return;
    }
    this.running = true;
    try {
      const pending = [
        ...(await listDraftsForTenant(this.opts.tenantId, 'pending')),
        ...(await listDraftsForTenant(this.opts.tenantId, 'failed')),
      ];
      for (const item of pending) {
        await this.syncOne(item);
      }
      this.attempt = 0;
    } catch {
      this.scheduleRetry();
    } finally {
      this.running = false;
      const still = await listDraftsForTenant(this.opts.tenantId, 'pending');
      const failed = await listDraftsForTenant(this.opts.tenantId, 'failed');
      if (still.length + failed.length > 0 && this.opts.isOnline()) {
        this.scheduleRetry();
      }
    }
  }

  private scheduleRetry(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = nextBackoffMs(
      this.attempt,
      this.opts.initialBackoffMs,
      this.opts.maxBackoffMs,
    );
    this.attempt += 1;
    this.timer = setTimeout(() => void this.drain(), delay);
  }

  private async syncOne(item: DraftQueueItem): Promise<void> {
    const syncing: DraftQueueItem = {
      ...item,
      status: 'syncing',
      updatedAt: new Date().toISOString(),
    };
    await putDraft(syncing);
    this.opts.onStatus?.(syncing);

    try {
      const result = await syncDraft(
        item.payload as DraftSyncBody,
        item.idempotencyKey,
        item.serverDocumentId ? item.baseRevision : undefined,
      );
      const synced: DraftQueueItem = {
        ...item,
        serverDocumentId: result.id,
        baseRevision: result.syncRevision,
        status: 'synced',
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      };
      await putDraft(synced);
      this.opts.onStatus?.(synced);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const conflict = e.body as SyncConflictPayload;
        const conflicted: DraftQueueItem = {
          ...item,
          status: 'conflict',
          lastError: conflict?.conflictId ?? 'conflict',
          payload: {
            ...item.payload,
            __conflictId: conflict?.conflictId,
          },
          updatedAt: new Date().toISOString(),
        };
        await putDraft(conflicted);
        this.opts.onStatus?.(conflicted);
        this.opts.onConflict?.(conflict, conflicted);
        return;
      }
      const failed: DraftQueueItem = {
        ...item,
        status: 'failed',
        lastError: e instanceof Error ? e.message : 'sync failed',
        updatedAt: new Date().toISOString(),
      };
      await putDraft(failed);
      this.opts.onStatus?.(failed);
      throw e;
    }
  }

  async enqueueSave(input: {
    idempotencyKey: string;
    payload: Record<string, unknown>;
    serverDocumentId?: string;
    baseRevision?: number;
  }): Promise<DraftQueueItem> {
    const prev = await getDraft(input.idempotencyKey);
    const item: DraftQueueItem = {
      idempotencyKey: input.idempotencyKey,
      tenantId: this.opts.tenantId,
      userId: this.opts.userId,
      serverDocumentId: input.serverDocumentId ?? prev?.serverDocumentId,
      baseRevision: input.baseRevision ?? prev?.baseRevision ?? 0,
      localRevision: (prev?.localRevision ?? 0) + 1,
      payload: input.payload,
      status: 'pending',
      updatedAt: new Date().toISOString(),
    };
    await putDraft(item);
    if (this.opts.isOnline()) void this.drain();
    return item;
  }

  async resolveConflictAndRetry(
    item: DraftQueueItem,
    conflictId: string,
    resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED',
    mergedPayload?: DraftSyncBody,
  ): Promise<void> {
    const result = await resolveSyncConflict(conflictId, {
      resolution,
      mergedPayload,
    });
    const next: DraftQueueItem = {
      ...item,
      serverDocumentId: result.id,
      baseRevision: result.syncRevision,
      status: resolution === 'KEEP_SERVER' ? 'synced' : 'pending',
      payload:
        resolution === 'KEEP_LOCAL' || resolution === 'MERGED'
          ? ((mergedPayload as Record<string, unknown>) ?? item.payload)
          : item.payload,
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };
    await putDraft(next);
    if (next.status === 'pending') await this.drain();
  }
}

export function statusLabelKey(status: DraftQueueStatus): string {
  return `sync.status.${status}`;
}
