import { apiFetch } from './client';

export type EtaCredentialsView = {
  id?: string;
  branchId: string | null;
  clientId: string;
  hasClientSecret: boolean;
  clientSecretMasked: string;
  registrationNumber: string | null;
  activityCode: string | null;
  isIntermediary: boolean;
  onBehalfOfRegistrationNumber: string | null;
  onBehalfOfName: string | null;
};

export function getEtaCredentials(branchId?: string) {
  const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return apiFetch<EtaCredentialsView | null>(`/settings/eta-credentials${q}`, {
    tenantScoped: true,
  });
}

export function upsertEtaCredentials(body: {
  branchId?: string | null;
  clientId: string;
  clientSecret?: string;
  registrationNumber?: string;
  activityCode?: string;
  isIntermediary?: boolean;
  onBehalfOfRegistrationNumber?: string;
  onBehalfOfName?: string;
}) {
  return apiFetch<EtaCredentialsView>('/settings/eta-credentials', {
    method: 'PUT',
    tenantScoped: true,
    body,
  });
}

export function rotateEtaSecret(clientSecret: string, branchId?: string) {
  return apiFetch<EtaCredentialsView>('/settings/eta-credentials/rotate-secret', {
    method: 'POST',
    tenantScoped: true,
    body: { clientSecret, branchId },
  });
}

/** @deprecated Prefer `testEtaConnection` from `@/lib/api/eta` */
export { testEtaConnection } from './eta';
