'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { getEtaEnvironment } from '@/lib/api/eta-environment';
import { useTenant } from '@/lib/tenant-provider';

/** Always-visible ETA host badge so users know sandbox vs production. */
export function EtaEnvironmentBadge() {
  const t = useTranslations('shell');
  const { tenantId } = useTenant();
  const env = useQuery({
    queryKey: ['eta-environment', tenantId],
    queryFn: () => getEtaEnvironment(),
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  const active = env.data?.activeEnvironment ?? 'SANDBOX';
  const label =
    active === 'PRODUCTION' ? t('etaEnvProduction') : t('etaEnvSandbox');

  return (
    <span
      className={`rounded px-token-sm py-token-xs text-token-xs font-semibold tracking-wide ${
        active === 'PRODUCTION'
          ? 'bg-danger/15 text-danger'
          : 'bg-brand-muted text-brand'
      }`}
      data-testid="shell-eta-env-badge"
      title={env.data?.apiBaseUrl}
    >
      {label}
    </span>
  );
}
