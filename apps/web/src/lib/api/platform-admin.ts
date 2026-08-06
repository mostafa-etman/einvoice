import { apiFetch } from './client';
import type { PlanCode, SubscriptionStatus } from './billing';

export type TenantSummary = {
  id: string;
  name: string;
  planCode: PlanCode | null;
  status: SubscriptionStatus | null;
  suspendedAt: string | null;
};

export type TenantDetail = TenantSummary & {
  ownerEmail: string | null;
  ownerId: string | null;
  graceEndsAt: string | null;
  entitlements: {
    planCode: PlanCode;
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    overrideActive: boolean;
  };
};

export type TenantUsage = {
  quotas: {
    documents: { used: number; limit: number };
    branches: { used: number; limit: number };
    devices: { used: number; limit: number };
  };
  meters: {
    period: { from: string; to: string; monthKey: string; timezone: string };
    documents: number;
    branches: number;
    devices: number;
  };
};

export type ImpersonationSessionView = {
  id: string;
  tenantId: string;
  targetUserId: string;
  mode: 'READ_ONLY' | 'WRITE';
  reason: string;
  expiresAt: string;
  accessToken: string;
};

export function listTenants(params?: {
  q?: string;
  status?: SubscriptionStatus;
  cursor?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status) qs.set('status', params.status);
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return apiFetch<{ items: TenantSummary[]; nextCursor: string | null }>(
    `/platform-admin/tenants${query ? `?${query}` : ''}`,
  );
}

export function provisionTenant(input: {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  planCode: PlanCode;
  reason?: string;
}) {
  return apiFetch<TenantDetail>('/platform-admin/tenants', {
    method: 'POST',
    body: input,
  });
}

export function getTenant(tenantId: string) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}`);
}

export function suspendTenant(tenantId: string, reason: string) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}/suspend`, {
    method: 'POST',
    body: { reason },
  });
}

export function activateTenant(tenantId: string, reason?: string) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}/activate`, {
    method: 'POST',
    body: { reason },
  });
}

export function assignPlan(
  tenantId: string,
  input: {
    planCode?: PlanCode;
    documentQuota?: number | null;
    branchQuota?: number | null;
    deviceQuota?: number | null;
    reason: string;
  },
) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}/plan`, {
    method: 'POST',
    body: input,
  });
}

export function getTenantUsage(tenantId: string) {
  return apiFetch<TenantUsage>(`/platform-admin/tenants/${tenantId}/usage`);
}

export function startImpersonation(input: {
  tenantId: string;
  targetUserId: string;
  reason: string;
  ttlMinutes?: number;
}) {
  return apiFetch<ImpersonationSessionView>('/platform-admin/impersonation', {
    method: 'POST',
    body: input,
  });
}

export function breakGlass(sessionId: string, reason: string) {
  return apiFetch<ImpersonationSessionView>(
    `/platform-admin/impersonation/${sessionId}/break-glass`,
    { method: 'POST', body: { reason } },
  );
}

export function endImpersonation(sessionId: string) {
  return apiFetch<{ ok: boolean } | void>(`/platform-admin/impersonation/${sessionId}/end`, {
    method: 'POST',
    body: {},
  });
}
