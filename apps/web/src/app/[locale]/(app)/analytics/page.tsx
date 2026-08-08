'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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

export default function AnalyticsPage() {
  const t = useTranslations('analytics');
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
  const [loading, setLoading] = useState(false);
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
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-brand">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          <span>{t('from')}</span>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>{t('to')}</span>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>{t('branch')}</span>
          <select
            className="rounded border px-2 py-1"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">{t('allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span>{t('currency')}</span>
          <input
            className="rounded border px-2 py-1"
            placeholder="EGP"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>{t('grain')}</span>
          <select
            className="rounded border px-2 py-1"
            value={grain}
            onChange={(e) => setGrain(e.target.value as 'day' | 'month')}
          >
            <option value="day">{t('grainDay')}</option>
            <option value="month">{t('grainMonth')}</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded bg-brand px-3 py-2 text-sm text-white"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? t('loading') : t('refresh')}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={exporting}
          onClick={() => void exportReport('CSV')}
        >
          {t('exportCsv')}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={exporting}
          onClick={() => void exportReport('XLSX')}
        >
          {t('exportXlsx')}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {summary ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t('asOf', { asOf: summary.asOf })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <div
                key={c.key}
                className="rounded border border-border bg-background p-4"
                data-meter={c.key}
              >
                <div className="text-sm text-muted-foreground">{c.label}</div>
                <div className="text-2xl font-semibold tabular-nums" dir="ltr">
                  {c.value}
                </div>
              </div>
            ))}
          </div>
          {summary.notes?.length ? (
            <ul className="list-disc ps-5 text-sm text-muted-foreground">
              {summary.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-lg font-medium">{t('chartDocuments')}</h2>
            <div className="h-72 w-full rounded border p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  {DOC_METERS.map((m, i) => (
                    <Bar
                      key={m}
                      dataKey={m}
                      name={t(`meters.${m}`)}
                      fill={['#0f766e', '#0369a1', '#16a34a', '#dc2626'][i]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h2 className="text-lg font-medium">{t('chartApi')}</h2>
              <div className="h-56 w-full rounded border p-2">
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
                      stroke="#7c3aed"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-medium">{t('chartStorage')}</h2>
              <div className="h-56 w-full rounded border p-2">
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
                      stroke="#ea580c"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
