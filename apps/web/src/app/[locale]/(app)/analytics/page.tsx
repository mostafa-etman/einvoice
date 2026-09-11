'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  createAnalyticsExport,
  downloadAnalyticsExport,
  fetchAnalyticsSeries,
  fetchAnalyticsSummary,
  fetchBranchesForFilter,
  type AnalyticsSummary,
  type MeterTotals,
} from '@/lib/api/analytics';
import { formatQuantityDisplay } from '@/lib/format-number';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FilterBar } from '@/components/ui/filter-bar';
import { StatCard } from '@/components/ui/stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import { ANALYTICS_CHART_COLORS } from './_components/chart-colors';

function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function daysAgoCairo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const DOC_METERS: (keyof MeterTotals)[] = [
  'issued',
  'received',
  'valid',
  'invalid',
];

const METER_TONE: Record<keyof MeterTotals, 'brand' | 'teal' | 'warning' | 'danger'> = {
  issued: 'brand',
  received: 'warning',
  valid: 'teal',
  invalid: 'danger',
  api_calls: 'brand',
  storage_bytes: 'warning',
};

export default function AnalyticsPage() {
  const t = useTranslations('analytics');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const [from, setFrom] = useState(() => daysAgoCairo(29));
  const [to, setTo] = useState(todayCairo);
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [grain, setGrain] = useState<'day' | 'month'>('day');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [series, setSeries] = useState<
    Array<{ bucket: string; values: MeterTotals }>
  >([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!tenantId) {
      setBranches([]);
      setBranchId('');
      return;
    }
    setBranches([]);
    setBranchId('');
    void fetchBranchesForFilter()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [tenantId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {
        from,
        to,
        branchId: branchId || undefined,
        currencyCode: currencyCode || undefined,
      };
      const [sum, ser] = await Promise.all([
        fetchAnalyticsSummary(filters),
        fetchAnalyticsSeries({ ...filters, grain }),
      ]);
      setSummary(sum);
      setSeries(ser.points);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
      setSummary(null);
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, branchId, currencyCode, grain, t, tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setSummary(null);
      setSeries([]);
      setLoading(false);
      return;
    }
    void load();
  }, [load, tenantId]);

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        bucket: p.bucket,
        issued: p.values.issued,
        received: p.values.received,
        valid: p.values.valid,
        invalid: p.values.invalid,
        api_calls: p.values.api_calls,
        storage_bytes: p.values.storage_bytes,
      })),
    [series],
  );

  const cards = useMemo(() => {
    if (!summary) return [];
    return (Object.keys(summary.totals) as (keyof MeterTotals)[]).map(
      (key) => ({
        key,
        label: t(`meters.${key}`),
        value: formatQuantityDisplay(summary.totals[key]),
      }),
    );
  }, [summary, t]);

  const exportReport = async (format: 'CSV' | 'XLSX') => {
    setExporting(true);
    setError(null);
    try {
      const job = await createAnalyticsExport({
        format,
        from,
        to,
        branchId: branchId || undefined,
        currencyCode: currencyCode || undefined,
        grain,
      });
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          await downloadAnalyticsExport(job.id);
          break;
        } catch {
          /* wait until READY */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('exportError'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-token-lg" aria-busy={loading || exporting || undefined}>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('home'), href: `/${locale}` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={exporting}
              loading={exporting}
              onClick={() => void exportReport('CSV')}
            >
              {t('exportCsv')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={exporting}
              onClick={() => void exportReport('XLSX')}
            >
              {t('exportXlsx')}
            </Button>
          </>
        }
      />

      <FilterBar>
        <Input
          type="date"
          label={t('from')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="date"
          label={t('to')}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Select
          label={t('branch')}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          <option value="">{t('allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Input
          label={t('currency')}
          placeholder="EGP"
          value={currencyCode}
          onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
        />
        <Select
          label={t('grain')}
          value={grain}
          onChange={(e) => setGrain(e.target.value as 'day' | 'month')}
        >
          <option value="day">{t('grainDay')}</option>
          <option value="month">{t('grainMonth')}</option>
        </Select>
        <Button
          type="button"
          disabled={loading}
          loading={loading}
          onClick={() => void load()}
        >
          {loading ? t('loading') : t('refresh')}
        </Button>
      </FilterBar>

      {error ? (
        <Card className="border-danger" role="alert">
          <p className="m-0 text-token-sm text-danger">{error}</p>
          <Button
            className="mt-token-sm"
            variant="secondary"
            size="sm"
            onClick={() => void load()}
          >
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      {loading && !summary ? (
        <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-surface p-token-md"
            >
              <Skeleton className="mb-token-xs w-1/2" />
              <Skeleton variant="rect" className="h-token-lg w-1/3" />
            </div>
          ))}
        </div>
      ) : null}

      {summary ? (
        <>
          <p className="m-0 font-en text-token-xs text-foreground-muted" dir="ltr">
            {t('asOf', { asOf: summary.asOf })}
          </p>
          <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <div key={c.key} data-meter={c.key}>
                <StatCard
                  label={c.label}
                  value={
                    <span className="font-en tabular-nums" dir="ltr">
                      {c.value}
                    </span>
                  }
                  tone={METER_TONE[c.key]}
                />
              </div>
            ))}
          </div>
          {summary.notes?.length ? (
            <ul className="list-disc ps-token-lg text-token-sm text-foreground-muted">
              {summary.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          <Card>
            <h2 className="m-0 mb-token-md text-token-lg font-semibold text-foreground">
              {t('chartDocuments')}
            </h2>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  {DOC_METERS.map((m) => (
                    <Bar
                      key={m}
                      dataKey={m}
                      name={t(`meters.${m}`)}
                      fill={ANALYTICS_CHART_COLORS[m]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-token-lg lg:grid-cols-2">
            <Card>
              <h2 className="m-0 mb-token-md text-token-lg font-semibold text-foreground">
                {t('chartApi')}
              </h2>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="api_calls"
                      name={t('meters.api_calls')}
                      stroke={ANALYTICS_CHART_COLORS.api_calls}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="m-0 mb-token-md text-token-lg font-semibold text-foreground">
                {t('chartStorage')}
              </h2>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="storage_bytes"
                      name={t('meters.storage_bytes')}
                      stroke={ANALYTICS_CHART_COLORS.storage_bytes}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
