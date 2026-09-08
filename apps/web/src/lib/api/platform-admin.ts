import { apiFetch } from './client';
import type { PlanCode, SubscriptionStatus } from './billing';

export type LifecycleStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export type TenantSummary = {
  id: string;
  name: string;
  planCode: PlanCode | null;
  status: SubscriptionStatus | null;
  lifecycleStatus: LifecycleStatus;
  activationStatus: 'PENDING' | 'ACTIVE' | 'REJECTED';
  suspendedAt: string | null;
  pointsBalance: number;
  trialEndsAt?: string | null;
  extraUsers?: number;
  extraCompanies?: number;
  createdAt: string;
  ownerEmail: string | null;
};

export type TenantDetail = TenantSummary & {
  ownerId: string | null;
  graceEndsAt: string | null;
  extraUsers?: number;
  extraCompanies?: number;
  trialEndsAt?: string | null;
  limits?: {
    maxUsers: number;
    maxCompanies: number;
    extraUsers: number;
    extraCompanies: number;
    users: { used: number; limit: number };
    companies: { used: number; limit: number };
  } | null;
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
  pointsBalance: number;
  limits?: {
    users: { used: number; limit: number };
    companies: { used: number; limit: number };
  };
  pointsLedger: {
    items: Array<{
      id: string;
      delta: number;
      balanceAfter: number;
      reason: string;
      documentKind: string | null;
      note: string | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
    consumedOnPage: number;
  };
};

export type PlanAdmin = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  documentQuota: number;
  branchQuota: number;
  deviceQuota: number;
  includedPoints: number;
  officialPriceEgp: number;
  discountedPriceEgp: number;
  maxUsers: number;
  maxCompanies: number;
  isTrial: boolean;
  isPublic: boolean;
  selfServe: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type DocumentCostView = {
  documentKind: string;
  points: number;
  standardPoints?: number;
  source: 'platform' | 'tenant';
};

export type AddonAdmin = {
  code: string;
  kind: 'POINTS' | 'USER' | 'COMPANY';
  name: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  quantity: number;
  officialPriceEgp: number;
  discountedPriceEgp: number;
  isActive: boolean;
  sortOrder: number;
};

export type PlatformSettings = {
  id: string;
  autoActivateSubCompanies: boolean;
  supportWhatsappE164: string;
  supportWhatsappDisplay: string;
  trialDays: number;
  trialPoints: number;
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
  lifecycle?: LifecycleStatus;
  cursor?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status) qs.set('status', params.status);
  if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
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

export function approveTenant(tenantId: string, reason?: string) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}/approve`, {
    method: 'POST',
    body: { reason },
  });
}

export function rejectTenant(tenantId: string, reason: string) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}/reject`, {
    method: 'POST',
    body: { reason },
  });
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
    userQuota?: number | null;
    companyQuota?: number | null;
    extraUsers?: number;
    extraCompanies?: number;
    trialEndsAt?: string | null;
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

export function adjustPoints(tenantId: string, delta: number, note?: string) {
  return apiFetch<{ tenantId: string; pointsBalance: number }>(
    `/platform-admin/tenants/${tenantId}/points`,
    { method: 'POST', body: { delta, note } },
  );
}

export function listAdminPlans() {
  return apiFetch<{ plans: PlanAdmin[] }>('/platform-admin/plans');
}

export function upsertPlan(input: {
  code: string;
  nameEn: string;
  nameAr: string;
  documentQuota: number;
  branchQuota: number;
  deviceQuota: number;
  includedPoints: number;
  officialPriceEgp?: number;
  discountedPriceEgp?: number;
  maxUsers?: number;
  maxCompanies?: number;
  isTrial?: boolean;
  isPublic?: boolean;
  selfServe?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}) {
  return apiFetch<PlanAdmin>('/platform-admin/plans', { method: 'POST', body: input });
}

export function setPlanActive(code: string, isActive: boolean) {
  return apiFetch<PlanAdmin>(`/platform-admin/plans/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: { isActive },
  });
}

export type TrialTaxRegistrationView = {
  taxRegistrationNormalized: string;
  firstTenantId: string | null;
  consumedAt: string;
};

export function listTrialTaxRegistrations() {
  return apiFetch<{ items: TrialTaxRegistrationView[] }>(
    '/platform-admin/trial-tax-registrations',
  );
}

export function resetTrialTaxRegistration(taxRegistrationNumber: string, reason?: string) {
  return apiFetch<{ reset: boolean; taxRegistrationNormalized: string }>(
    '/platform-admin/trial-tax-registrations/reset',
    { method: 'POST', body: { taxRegistrationNumber, reason } },
  );
}

export function listAdminAddons() {
  return apiFetch<{ addons: AddonAdmin[] }>('/platform-admin/addons');
}

export function upsertAddon(input: {
  code: string;
  kind: 'POINTS' | 'USER' | 'COMPANY';
  nameEn: string;
  nameAr: string;
  quantity: number;
  officialPriceEgp: number;
  discountedPriceEgp: number;
  isActive?: boolean;
  sortOrder?: number;
}) {
  return apiFetch<AddonAdmin>('/platform-admin/addons', { method: 'POST', body: input });
}

export function applyAddon(tenantId: string, addonCode: string, reason?: string) {
  return apiFetch<TenantDetail>(`/platform-admin/tenants/${tenantId}/addons`, {
    method: 'POST',
    body: { addonCode, reason },
  });
}

export function getDocumentCosts() {
  return apiFetch<DocumentCostView[]>('/platform-admin/document-costs');
}

export function setDocumentCosts(
  items: Array<{ documentKind: string; points: number; standardPoints?: number }>,
) {
  return apiFetch<DocumentCostView[]>('/platform-admin/document-costs', {
    method: 'PUT',
    body: { items },
  });
}

export function getSettings() {
  return apiFetch<PlatformSettings>('/platform-admin/settings');
}

export function updateSettings(patch: Partial<PlatformSettings>) {
  return apiFetch<PlatformSettings>('/platform-admin/settings', {
    method: 'PATCH',
    body: patch,
  });
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
