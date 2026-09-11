'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTimeDisplay } from '@/lib/format-date';
import { cn } from '@/lib/cn';

export function EtaStatusCard({
  configured,
  environment,
  lastValidatedAt,
  loading,
  error,
}: {
  configured: boolean | null;
  environment: 'SANDBOX' | 'PRODUCTION' | null;
  lastValidatedAt: string | null;
  loading: boolean;
  error: boolean;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const envLabel =
    environment === 'PRODUCTION' ? t('etaEnvProduction') : t('etaEnvSandbox');

  return (
    <section
      className="rounded-lg border border-border-dark bg-navy px-token-lg py-token-md text-on-dark shadow-sm"
      data-testid="dashboard-eta"
    >
      <h3 className="m-0 text-token-sm font-semibold text-on-dark">{t('etaTitle')}</h3>
      {loading ? (
        <div className="mt-token-md flex flex-col gap-token-sm" data-testid="dashboard-eta-loading">
          <Skeleton className="h-token-md w-2/3 bg-nav-hover" />
          <Skeleton className="w-full bg-nav-hover" />
        </div>
      ) : error || configured == null ? (
        <p className="mt-token-md text-token-sm text-on-dark-muted" role="status">
          {t('etaUnavailable')}
        </p>
      ) : configured ? (
        <>
          <div className="my-token-md flex items-center gap-token-sm">
            <span
              className={cn(
                'size-[var(--size-badge-dot)] rounded-pill bg-brand-teal',
                'shadow-[0_0_0_4px_var(--color-brand-teal-muted)]',
              )}
              aria-hidden
            />
            <span className="font-medium text-on-dark">
              {t('etaConnected', { environment: envLabel })}
            </span>
          </div>
          <p className="m-0 text-token-xs text-on-dark-muted">
            {lastValidatedAt
              ? t('etaLastValidated', {
                  when: formatDateTimeDisplay(lastValidatedAt, locale),
                })
              : t('etaLastValidatedUnknown')}
          </p>
        </>
      ) : (
        <>
          <div className="my-token-md flex items-center gap-token-sm">
            <span
              className="size-[var(--size-badge-dot)] rounded-pill bg-foreground-subtle"
              aria-hidden
            />
            <span className="font-medium text-on-dark">{t('etaDisconnected')}</span>
          </div>
          <p className="m-0 text-token-xs text-on-dark-muted">{t('etaDisconnectedHint')}</p>
          <Button
            className="mt-token-md"
            size="sm"
            variant="secondary"
            onClick={() => router.push(`/${locale}/settings/eta-credentials`)}
          >
            {t('openCredentials')}
          </Button>
        </>
      )}
    </section>
  );
}
