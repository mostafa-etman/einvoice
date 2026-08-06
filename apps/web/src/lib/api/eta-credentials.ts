import { apiFetch } from './client';

export type EtaEnvironment = 'SANDBOX' | 'PRODUCTION';

export type EtaCredentialsView = {
  id?: string;
  branchId: string | null;
  environment: EtaEnvironment;
  clientId: string;
  hasClientSecret: boolean;
  clientSecretMasked: string;
  registrationNumber: string | null;
  activityCode: string | null;
  isIntermediary: boolean;
  onBehalfOfRegistrationNumber: string | null;
  onBehalfOfName: string | null;
  /** Taxpayer legal name → ETA issuer.name */
  taxpayerLegalName: string | null;
  issuerType: string;
  issuerIdentityComplete: boolean;
  lastValidatedAt: string | null;
  activeEnvironment: EtaEnvironment;
};

export function getEtaCredentials(opts?: {
  branchId?: string;
  environment?: EtaEnvironment;
}) {
  const params = new URLSearchParams();
  if (opts?.branchId) params.set('branchId', opts.branchId);
  if (opts?.environment) params.set('environment', opts.environment);
  const q = params.toString() ? `?${params}` : '';
  return apiFetch<EtaCredentialsView | null>(`/settings/eta-credentials${q}`, {
    tenantScoped: true,
  });
}

export function upsertEtaCredentials(body: {
  branchId?: string | null;
  environment?: EtaEnvironment;
  clientId: string;
  clientSecret?: string;
  registrationNumber?: string;
  activityCode?: string;
  isIntermediary?: boolean;
  onBehalfOfRegistrationNumber?: string;
  onBehalfOfName?: string;
  taxpayerLegalName?: string;
  issuerType?: string;
}) {
  return apiFetch<EtaCredentialsView>('/settings/eta-credentials', {
    method: 'PUT',
    tenantScoped: true,
    body,
  });
}

export function rotateEtaSecret(
  clientSecret: string,
  opts?: { branchId?: string; environment?: EtaEnvironment },
) {
  return apiFetch<EtaCredentialsView>('/settings/eta-credentials/rotate-secret', {
    method: 'POST',
    tenantScoped: true,
    body: {
      clientSecret,
      branchId: opts?.branchId,
      environment: opts?.environment,
    },
  });
}

/** @deprecated Prefer `testEtaConnection` from `@/lib/api/eta` */
export { testEtaConnection } from './eta';
