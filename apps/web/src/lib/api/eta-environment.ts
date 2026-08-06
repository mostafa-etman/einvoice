import { apiFetch } from './client';

export type EtaEnvironment = 'SANDBOX' | 'PRODUCTION';

export type EtaEnvironmentStatus = {
  activeEnvironment: EtaEnvironment;
  label: 'sandbox' | 'production';
  identityBaseUrl: string;
  apiBaseUrl: string;
  sandboxCredentialsConfigured: boolean;
  productionCredentialsConfigured: boolean;
  productionValidatedAt: string | null;
  canSwitchToProduction: boolean;
  sandboxDocumentCount: number;
  productionDocumentCount: number;
  productionProtectedCount: number;
};

export type ClearSandboxResult = {
  deletedDocuments: number;
  deletedReceivedDocuments: number;
  deletedSubmissions: number;
  deletedArtifacts: number;
  skippedProductionProtected: number;
};

export function getEtaEnvironment() {
  return apiFetch<EtaEnvironmentStatus>('/settings/eta-environment', {
    tenantScoped: true,
  });
}

export function switchEtaEnvironment(environment: EtaEnvironment) {
  return apiFetch<EtaEnvironmentStatus>('/settings/eta-environment', {
    method: 'PUT',
    tenantScoped: true,
    body: { environment },
  });
}

export function clearSandboxData(confirmation: string) {
  return apiFetch<ClearSandboxResult>('/settings/eta-environment/clear-sandbox', {
    method: 'POST',
    tenantScoped: true,
    body: { confirmation },
  });
}

export function goLive(opts: {
  clearSandboxData?: boolean;
  confirmation?: string;
}) {
  return apiFetch<{
    environment: EtaEnvironmentStatus;
    clear?: ClearSandboxResult;
  }>('/settings/eta-environment/go-live', {
    method: 'POST',
    tenantScoped: true,
    body: opts,
  });
}
