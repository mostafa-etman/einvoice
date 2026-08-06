import type { EtaEnvironment } from '@prisma/client';
import type { ApiEnv } from '../config/env';

export type EtaHostUrls = {
  environment: EtaEnvironment;
  identityBaseUrl: string;
  apiBaseUrl: string;
  label: 'sandbox' | 'production';
};

/** Resolve identity + API base URLs for a given ETA environment from config. */
export function resolveEtaHostUrls(
  environment: EtaEnvironment,
  env: Pick<
    ApiEnv,
    | 'ETA_IDENTITY_BASE_URL'
    | 'ETA_API_BASE_URL'
    | 'ETA_PRODUCTION_IDENTITY_BASE_URL'
    | 'ETA_PRODUCTION_API_BASE_URL'
  >,
): EtaHostUrls {
  if (environment === 'PRODUCTION') {
    return {
      environment: 'PRODUCTION',
      identityBaseUrl: env.ETA_PRODUCTION_IDENTITY_BASE_URL,
      apiBaseUrl: env.ETA_PRODUCTION_API_BASE_URL,
      label: 'production',
    };
  }
  return {
    environment: 'SANDBOX',
    identityBaseUrl: env.ETA_IDENTITY_BASE_URL,
    apiBaseUrl: env.ETA_API_BASE_URL,
    label: 'sandbox',
  };
}

export function etaEnvironmentLabel(environment: EtaEnvironment): 'sandbox' | 'production' {
  return environment === 'PRODUCTION' ? 'production' : 'sandbox';
}

/** ETA statuses that count as official tax records (never clearable in PRODUCTION). */
export const PRODUCTION_PROTECTED_ETA_STATUSES = new Set(
  [
    'Submitted',
    'Valid',
    'Invalid',
    'Cancelled',
    'Rejected',
    'Accepted',
  ].map((s) => s.toLowerCase()),
);

export function isProductionProtectedDocument(doc: {
  etaEnvironment: EtaEnvironment | null | undefined;
  etaUuid?: string | null;
  etaStatus?: string | null;
  status?: string | null;
}): boolean {
  if (doc.etaEnvironment !== 'PRODUCTION') return false;
  if (doc.etaUuid) return true;
  const eta = (doc.etaStatus ?? '').trim().toLowerCase();
  if (eta && PRODUCTION_PROTECTED_ETA_STATUSES.has(eta)) return true;
  const st = (doc.status ?? '').trim().toUpperCase();
  return st === 'SUBMITTED' || st === 'ACCEPTED' || st === 'VALID' || st === 'CANCELLED';
}
