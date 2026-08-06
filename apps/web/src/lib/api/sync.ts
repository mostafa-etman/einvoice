import { apiFetch, ApiError } from './client';
import type { DocumentUpsert } from './documents';

export type DraftSyncBody = DocumentUpsert & {
  clientIdempotencyKey?: string;
};

export type DraftSyncResult = {
  id: string;
  syncRevision: number;
  clientIdempotencyKey: string;
  status: string;
};

export type SyncConflictPayload = {
  conflictId: string;
  documentId: string;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  conflictingPaths?: string[];
};

export type ConflictResolution = {
  resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED';
  mergedPayload?: DraftSyncBody;
};

/** PUT /sync/drafts — always sends Idempotency-Key. */
export async function syncDraft(
  body: DraftSyncBody,
  idempotencyKey: string,
  ifMatchRevision?: number,
): Promise<DraftSyncResult> {
  const headers: Record<string, string> = {
    'Idempotency-Key': idempotencyKey,
  };
  if (ifMatchRevision !== undefined) {
    headers['If-Match-Revision'] = String(ifMatchRevision);
  }
  return apiFetch<DraftSyncResult>('/sync/drafts', {
    method: 'PUT',
    tenantScoped: true,
    body: { ...body, clientIdempotencyKey: idempotencyKey },
    headers,
  });
}

export async function resolveSyncConflict(
  conflictId: string,
  body: ConflictResolution,
): Promise<DraftSyncResult> {
  return apiFetch<DraftSyncResult>(`/sync/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export { ApiError };
