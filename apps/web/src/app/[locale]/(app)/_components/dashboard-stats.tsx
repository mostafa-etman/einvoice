'use client';

import { useTranslations } from 'next-intl';
import type { MeterTotals } from '@/lib/api/analytics';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPercent, formatQuantityDisplay } from '@/lib/format-number';
import { deltaDirection, monthOverMonthRatio } from './dashboard-dates';
import { DocumentIcon, InvalidIcon, ReceivedIcon, ValidIcon } from './dashboard-icons';

type KpiKey = 'issued' | 'valid' | 'received' | 'invalid';

const KPI_META: Array<{
  key: KpiKey;
  tone: 'brand' | 'teal' | 'warning' | 'danger';
  icon: typeof DocumentIcon;
}> = [
  { key: 'issued', tone: 'brand', icon: DocumentIcon },
  { key: 'valid', tone: 'teal', icon: ValidIcon },
  { key: 'received', tone: 'warning', icon: ReceivedIcon },
  { key: 'invalid', tone: 'danger', icon: InvalidIcon },
];

export function DashboardStats({
  totals,
  previous,
  loading,
  error,
  onRetry,
}: {
  totals: MeterTotals | undefined;
  previous: MeterTotals | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');

  if (loading) {
    return (
      <div
        className="mb-token-lg grid gap-token-md [grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]"
        data-testid="dashboard-stats-loading"
      >
        {KPI_META.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-border bg-surface p-token-md"
          >
            <Skeleton variant="rect" className="mb-token-sm size-token-xl rounded-md" />
            <Skeleton className="mb-token-xs w-2/3" />
            <Skeleton variant="rect" className="h-token-lg w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="mb-token-lg rounded-lg border border-border bg-surface px-token-lg py-token-md"
        data-testid="dashboard-stats-error"
        role="alert"
      >
        <p className="m-0 text-token-sm text-danger">{t('statsError')}</p>
        <Button className="mt-token-sm" size="sm" variant="secondary" onClick={onRetry}>
          {tCommon('actions.retry')}
        </Button>
      </div>
    );
  }

  if (!totals) {
    return null;
  }

  const validityDenom = totals.valid + totals.invalid;
  const validityRatio = validityDenom > 0 ? totals.valid / validityDenom : null;

  return (
    <div
      className="mb-token-lg grid gap-token-md [grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]"
      data-testid="dashboard-stats"
    >
      {KPI_META.map((item) => {
        const Icon = item.icon;
        const mom = previous
          ? monthOverMonthRatio(totals[item.key], previous[item.key])
          : null;
        const delta =
          item.key === 'valid' && validityRatio != null
            ? {
                direction: 'flat' as const,
                label: t('kpi.validityRate', {
                  percent: formatPercent(validityRatio),
                }),
              }
            : mom != null
              ? {
                  direction: deltaDirection(mom),
                  label: t('kpi.vsPrevious', {
                    percent: formatPercent(Math.abs(mom)),
                  }),
                }
              : undefined;

        return (
          <div key={item.key} data-testid={`dashboard-kpi-${item.key}`}>
            <StatCard
              label={t(`kpi.${item.key}`)}
              value={formatQuantityDisplay(totals[item.key], 0)}
              tone={item.tone}
              icon={<Icon />}
              delta={delta}
            />
          </div>
        );
      })}
    </div>
  );
}
