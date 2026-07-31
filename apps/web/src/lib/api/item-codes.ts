import { apiFetch } from './client';

export type ItemCode = {
  id: string;
  type: 'EGS' | 'GS1';
  code: string;
  description: string;
  isActive: boolean;
  source?: 'LOCAL' | 'ETA';
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
};

export type ItemCodeSyncLatest = {
  syncRunId: string | null;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | null;
  startedAt: string | null;
  finishedAt: string | null;
  added: number;
  updated: number;
  unchanged: number;
  errors: unknown;
  lastSyncAt: string | null;
};

export function listItemCodes() {
  return apiFetch<ItemCode[]>('/item-codes', { tenantScoped: true });
}

export function createItemCode(body: {
  type: 'EGS' | 'GS1';
  code: string;
  description: string;
}) {
  return apiFetch<ItemCode>('/item-codes', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export function updateItemCode(
  id: string,
  body: { description?: string; isActive?: boolean },
) {
  return apiFetch<ItemCode>(`/item-codes/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body,
  });
}

export function startItemCodeSync() {
  return apiFetch<{ syncRunId: string; status: string }>('/item-codes/sync', {
    method: 'POST',
    tenantScoped: true,
  });
}

export function getLatestItemCodeSync() {
  return apiFetch<ItemCodeSyncLatest>('/item-codes/sync/latest', {
    tenantScoped: true,
  });
}
