'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { getEtaEnvironment } from '@/lib/api/eta-environment';
import { useTenant } from '@/lib/tenant-provider';
import { cn } from '@/lib/cn';

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
      className={cn(
        'inline-flex items-center gap-token-sm rounded-pill px-token-sm py-token-xs text-token-xs font-semibold tracking-wide',
        active === 'PRODUCTION'
          ? 'bg-danger-muted text-danger'
          : 'bg-warning-muted text-warning',
      )}
      data-testid="shell-eta-env-badge"
      title={env.data?.apiBaseUrl}
    >
      <span className="size-[var(--size-badge-dot)] rounded-pill bg-current" aria-hidden />
      {label}
    </span>
  );
}
