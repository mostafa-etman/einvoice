import { apiFetch } from './client';

export type EtaConnectionStatus = {
  connected: boolean;
  setupRequired: boolean;
  expiresAt: string | null;
  scope: string | null;
  environment: string | null;
  lastTestOutcome: 'success' | 'failure' | 'never';
  lastTestMessage: string | null;
  settingsPath: string;
  /** Present on successful Test Connection only; do not display in UI. */
  accessToken?: string;
};

export type DocTypesResponse = {
  items: Record<string, unknown>[];
  fetchedAt: string;
  fromCache: boolean;
};

export type DocTypeVersionsResponse = {
  documentTypeId: string;
  items: Record<string, unknown>[];
  fetchedAt: string;
  fromCache: boolean;
};

export function getEtaConnection() {
  return apiFetch<EtaConnectionStatus>('/settings/eta/connection', {
    tenantScoped: true,
  });
}

export function testEtaConnection(branchId?: string) {
  return apiFetch<EtaConnectionStatus>(
    '/settings/eta-credentials/test-connection',
    {
      method: 'POST',
      tenantScoped: true,
      body: { branchId },
    },
  );
}

export function listEtaDocumentTypes(refresh = false) {
  const q = refresh ? '?refresh=true' : '';
  return apiFetch<DocTypesResponse>(`/settings/eta/document-types${q}`, {
    tenantScoped: true,
  });
}

export function getEtaDocumentTypeVersions(typeId: string, refresh = false) {
  const q = refresh ? '?refresh=true' : '';
  return apiFetch<DocTypeVersionsResponse>(
    `/settings/eta/document-types/${encodeURIComponent(typeId)}/versions${q}`,
    { tenantScoped: true },
  );
}
