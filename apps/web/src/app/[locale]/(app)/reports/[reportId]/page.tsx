'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
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
  downloadReportExport,
  fetchBranchesForFilter,
  fetchReport,
  type ReportId,
  type ReportPayload,
} from '@/lib/api/reports';
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

const PDF_IDS = new Set(['S1', 'P1', 'S4', 'P3', 'C1']);

export default function ReportDetailPage() {
  const routeParams = useParams<{ reportId: string }>();
  const reportId = String(routeParams.reportId ?? '').toUpperCase() as ReportId;
  const t = useTranslations('reports');
  const locale = useLocale();
  const { tenantId } = useTenant();

  const [from, setFrom] = useState(() => daysAgoCairo(29));
  const [to, setTo] = useState(todayCairo);
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [grain, setGrain] = useState<'day' | 'month'>('day');
  const [showGross, setShowGross] = useState(false);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [perBranch, setPerBranch] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (reportId === 'C1') setPerBranch(true);
  }, [reportId]);

  useEffect(() => {
    if (!tenantId) {
      setBranches([]);
      return;
    }
    void fetchBranchesForFilter()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [tenantId]);

  const filters = useMemo(
    () => ({
      from,
      to,
      branchId: branchId || undefined,
      currencyCode: currencyCode || undefined,
      grain,
      showGross,
      includeNonFinancialStatuses: includeOthers,
      perBranch: reportId === 'C1' ? perBranch : false,
    }),
    [
      from,
      to,
      branchId,
      currencyCode,
      grain,
      showGross,
      includeOthers,
      perBranch,
      reportId,
    ],
  );

  const load = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReport(reportId, filters);
      setData(res);
    } catch {
      setError(t('error'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [reportId, filters, t]);

  useEffect(() => {
    if (!tenantId) return;
    void load();
  }, [tenantId, load]);

  const exportFile = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    setExporting(true);
    try {
      await downloadReportExport(reportId, format, filters);
    } catch {
      setError(t('exportError'));
    } finally {
      setExporting(false);
    }
  };

  const chartRows = (
    Array.isArray(data?.chart?.data)
      ? data!.chart!.data
      : (data?.series ?? data?.rows ?? [])
  ) as Array<Record<string, unknown>>;

  const summaryEntries = Object.entries(data?.summary ?? {}).filter(
    ([, v]) => typeof v !== 'object' || v === null,
  );

  return (
    <div className="space-y-token-lg p-token-lg">
      <div className="flex flex-wrap items-center justify-between gap-token-sm">
        <div>
          <Link
            href={`/${locale}/reports`}
            className="text-sm text-muted hover:underline"
          >
            {t('back')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {reportId} — {t(`catalog.${reportId}.name`)}
          </h1>
          <p className="text-sm text-muted">{t(`catalog.${reportId}.desc`)}</p>
        </div>
        <div className="flex flex-wrap gap-token-xs">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            disabled={exporting}
            onClick={() => void exportFile('CSV')}
          >
            {t('exportCsv')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            disabled={exporting}
            onClick={() => void exportFile('XLSX')}
          >
            {t('exportXlsx')}
          </button>
          {PDF_IDS.has(reportId) ? (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              disabled={exporting}
              onClick={() => void exportFile('PDF')}
            >
              {t('exportPdf')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-token-sm rounded-md border border-border bg-surface p-token-md">
        <label className="text-sm">
          {t('from')}
          <input
            type="date"
            className="ms-2 rounded border border-border bg-background px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('to')}
          <input
            type="date"
            className="ms-2 rounded border border-border bg-background px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('branch')}
          <select
            className="ms-2 rounded border border-border bg-background px-2 py-1"
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
        <label className="text-sm">
          {t('currency')}
          <input
            className="ms-2 w-20 rounded border border-border bg-background px-2 py-1"
            value={currencyCode}
            placeholder="EGP"
            onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
          />
        </label>
        {(reportId === 'S1' || reportId === 'P1' || reportId === 'C2') && (
          <label className="text-sm">
            {t('grain')}
            <select
              className="ms-2 rounded border border-border bg-background px-2 py-1"
              value={grain}
              onChange={(e) => setGrain(e.target.value as 'day' | 'month')}
            >
              <option value="day">{t('grainDay')}</option>
              <option value="month">{t('grainMonth')}</option>
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showGross}
            onChange={(e) => setShowGross(e.target.checked)}
          />
          {t('showGross')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeOthers}
            onChange={(e) => setIncludeOthers(e.target.checked)}
          />
          {t('includeOthers')}
        </label>
        {reportId === 'C1' ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={perBranch}
              onChange={(e) => setPerBranch(e.target.checked)}
            />
            {t('perBranch')}
          </label>
        ) : null}
        <button
          type="button"
          className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? t('loading') : t('refresh')}
        </button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {data ? (
        <>
          <section className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-4">
            {summaryEntries.map(([k, v]) => (
              <div
                key={k}
                className="rounded-md border border-border bg-surface px-token-md py-token-sm"
              >
                <div className="text-xs text-muted">{k}</div>
                <div className="text-lg font-semibold tabular-nums">
                  {String(v)}
                </div>
              </div>
            ))}
            {reportId === 'C1' && data.summary?.position ? (
              <div className="rounded-md border border-border bg-surface px-token-md py-token-sm">
                <div className="text-xs text-muted">{t('position')}</div>
                <div className="text-lg font-semibold">
                  {t(`positions.${String(data.summary.position)}`)}
                </div>
              </div>
            ) : null}
          </section>

          {chartRows.length > 0 ? (
            <section className="h-72 rounded-md border border-border bg-surface p-token-md">
              <ResponsiveContainer width="100%" height="100%">
                {reportId === 'C2' || reportId === 'S1' || reportId === 'P1' ? (
                  <LineChart data={chartRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {reportId === 'C2' ? (
                      <>
                        <Line type="monotone" dataKey="sales" stroke="#0f766e" />
                        <Line
                          type="monotone"
                          dataKey="purchases"
                          stroke="#b45309"
                        />
                      </>
                    ) : (
                      <Line type="monotone" dataKey="net" stroke="#0f766e" />
                    )}
                  </LineChart>
                ) : (
                  <BarChart data={chartRows.slice(0, 20)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey={
                        reportId === 'S2'
                          ? 'customerName'
                          : reportId === 'P2'
                            ? 'supplierName'
                            : reportId === 'S3'
                              ? 'itemCode'
                              : reportId === 'C1'
                                ? 'name'
                                : reportId === 'C3'
                                  ? 'status'
                                  : 'rate'
                      }
                    />
                    <YAxis />
                    <Tooltip />
                    <Bar
                      dataKey={
                        reportId === 'C3'
                          ? 'count'
                          : reportId === 'C1' ||
                              reportId === 'S4' ||
                              reportId === 'P3'
                            ? 'amount'
                            : 'net'
                      }
                      fill="#0f766e"
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </section>
          ) : null}

          <section className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  {Object.keys((data.rows ?? [])[0] ?? { empty: '' }).map(
                    (col) => (
                      <th
                        key={col}
                        className="border-b border-border px-3 py-2 text-start font-medium"
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(data.rows ?? []).map((row, i) => (
                  <tr key={i} className="odd:bg-background even:bg-surface/40">
                    {Object.keys((data.rows ?? [])[0] ?? {}).map((col) => (
                      <td
                        key={col}
                        className="border-b border-border px-3 py-2 tabular-nums"
                      >
                        {String(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
