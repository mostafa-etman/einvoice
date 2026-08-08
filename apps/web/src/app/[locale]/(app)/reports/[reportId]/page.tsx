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
import { formatMoneyDisplay, formatQuantityDisplay } from '@/lib/format-number';

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

const PDF_IDS = new Set(['S1', 'P1', 'S4', 'P3', 'C1', 'C4']);

const FIELD_KEYS = new Set([
  'bucket',
  'bucketLabel',
  'net',
  'gross',
  'grossPositive',
  'creditReduction',
  'sales',
  'purchases',
  'customerName',
  'supplierName',
  'itemName',
  'itemCode',
  'description',
  'quantity',
  'amount',
  'rate',
  'count',
  'status',
  'name',
  'taxType',
  'taxTypeName',
  'subType',
  'subTypeName',
  'side',
  'category',
  'taxableValue',
  'taxAmount',
  'branchId',
  'branchName',
  'currency',
  'currencyCode',
  'outputVat',
  'inputVat',
  'netVat',
  'withholding',
  'withholdingOutput',
  'withholdingInput',
  'documentCount',
  'rowCount',
  'otherTaxes',
  'salesNet',
  'purchasesNet',
  'empty',
  'position',
]);

const HIDDEN_ROW_KEYS = new Set([
  'bucketLabelEn',
  'bucketLabelAr',
  'taxTypeNameEn',
  'taxTypeNameAr',
  'subTypeNameEn',
  'subTypeNameAr',
  'customerKey',
  'supplierKey',
]);

function monthStartCairo(): string {
  const today = todayCairo();
  return `${today.slice(0, 7)}-01`;
}

function pickLocaleName(
  locale: string,
  nameEn: unknown,
  nameAr: unknown,
  fallback: unknown,
): string {
  const en = String(nameEn ?? '').trim();
  const ar = String(nameAr ?? '').trim();
  const fb = String(fallback ?? '').trim();
  if (locale === 'ar') return ar || en || fb;
  return en || ar || fb;
}

function localizeReportRows(
  rows: Array<Record<string, unknown>>,
  locale: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    const bucketLabel = pickLocaleName(
      locale,
      row.bucketLabelEn,
      row.bucketLabelAr,
      row.bucket,
    );
    const taxTypeName = pickLocaleName(
      locale,
      row.taxTypeNameEn,
      row.taxTypeNameAr,
      '',
    );
    const subTypeName = pickLocaleName(
      locale,
      row.subTypeNameEn,
      row.subTypeNameAr,
      '',
    );

    for (const [k, v] of Object.entries(row)) {
      if (HIDDEN_ROW_KEYS.has(k)) continue;
      if (k === 'bucket' && bucketLabel) {
        out.bucket = bucketLabel;
        continue;
      }
      if (k === 'taxType') {
        const code = String(v ?? '');
        out.taxType = taxTypeName && code ? `${taxTypeName} (${code})` : code;
        continue;
      }
      if (k === 'subType') {
        const code = String(v ?? '');
        out.subType =
          subTypeName && code ? `${subTypeName} (${code})` : code || '—';
        continue;
      }
      out[k] = v;
    }
    if (!('bucket' in out) && bucketLabel) out.bucket = bucketLabel;
    if ('itemCode' in row) {
      const name = String(row.itemName ?? '').trim();
      const desc = String(row.description ?? '').trim();
      const code = String(row.itemCode ?? '').trim();
      out.itemName = name || desc || code || '—';
    }
    return out;
  });
}

function cellDisplayValue(
  col: string,
  value: unknown,
  labels: { total: string; unassigned: string },
): string {
  if (col === 'branchName') {
    if (value === '__TOTAL__') return labels.total;
    if (value === '__UNASSIGNED__') return labels.unassigned;
  }
  if (col === 'quantity' || col === 'rate' || col === 'count' || col === 'documentCount' || col === 'rowCount') {
    return formatQuantityDisplay(value);
  }
  if (
    col === 'net' ||
    col === 'gross' ||
    col === 'grossPositive' ||
    col === 'creditReduction' ||
    col === 'amount' ||
    col === 'sales' ||
    col === 'purchases' ||
    col === 'outputVat' ||
    col === 'inputVat' ||
    col === 'netVat' ||
    col === 'withholding' ||
    col === 'withholdingOutput' ||
    col === 'withholdingInput' ||
    col === 'taxableValue' ||
    col === 'taxAmount' ||
    col === 'otherTaxes' ||
    col === 'salesNet' ||
    col === 'purchasesNet'
  ) {
    return formatMoneyDisplay(value);
  }
  if (value == null || value === '') return '—';
  return String(value);
}

export default function ReportDetailPage() {
  const routeParams = useParams<{ reportId: string }>();
  const reportId = String(routeParams.reportId ?? '').toUpperCase() as ReportId;
  const t = useTranslations('reports');
  const locale = useLocale();
  const { tenantId } = useTenant();

  const [from, setFrom] = useState(() =>
    reportId === 'C4' ? monthStartCairo() : daysAgoCairo(29),
  );
  const [to, setTo] = useState(todayCairo);
  const [branchId, setBranchId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [grain, setGrain] = useState<'day' | 'month'>(() =>
    reportId === 'S1' ? 'month' : 'day',
  );
  const [showGross, setShowGross] = useState(false);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [perBranch, setPerBranch] = useState(false);
  const [taxType, setTaxType] = useState('');
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (reportId === 'S1') setGrain('month');
  }, [reportId]);

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
      taxType: reportId === 'C4' && taxType ? taxType : undefined,
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
      taxType,
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

  const chartRows = useMemo(() => {
    const raw = (
      Array.isArray(data?.chart?.data)
        ? data!.chart!.data
        : (data?.series ?? data?.rows ?? [])
    ) as Array<Record<string, unknown>>;
    return localizeReportRows(raw, locale).map((row) => {
      const name = row.name;
      if (typeof name === 'string' && FIELD_KEYS.has(name)) {
        return { ...row, name: t(`fields.${name}` as 'fields.net') };
      }
      return row;
    });
  }, [data, locale, t]);

  const tableRows = useMemo(
    () => localizeReportRows((data?.rows ?? []) as Array<Record<string, unknown>>, locale),
    [data, locale],
  );

  const branchLabels = useMemo(
    () => ({
      total: t('fields.total'),
      unassigned: t('fields.unassigned'),
    }),
    [t],
  );

  const summaryEntries = Object.entries(data?.summary ?? {}).filter(
    ([k, v]) =>
      k !== 'period' &&
      k !== 'taxTypeFilter' &&
      (typeof v !== 'object' || v === null),
  );

  const fieldLabel = (col: string) =>
    FIELD_KEYS.has(col) ? t(`fields.${col}` as 'fields.net') : col;

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
            {reportId === 'S1' ? (
              <span className="ms-2 rounded border border-border bg-background px-2 py-1">
                {t('grainMonth')}
              </span>
            ) : (
              <select
                className="ms-2 rounded border border-border bg-background px-2 py-1"
                value={grain}
                onChange={(e) => setGrain(e.target.value as 'day' | 'month')}
              >
                <option value="day">{t('grainDay')}</option>
                <option value="month">{t('grainMonth')}</option>
              </select>
            )}
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
        {reportId === 'C4' ? (
          <label className="text-sm">
            {t('taxType')}
            <select
              className="ms-2 rounded border border-border bg-background px-2 py-1"
              value={taxType}
              onChange={(e) => setTaxType(e.target.value)}
            >
              <option value="">{t('taxTypeAll')}</option>
              {(data?.taxTypes ?? ['T1', 'T2', 'T3', 'T4']).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
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

      {data && reportId === 'C4' ? (
        <>
          <p className="rounded border border-amber-300 bg-amber-50 px-token-md py-token-sm text-token-sm text-amber-950">
            {t('vatReturnDisclaimer')}
          </p>
          <section className="space-y-token-sm">
            <h2 className="text-lg font-semibold">{t('vatReturnTitle')}</h2>
            <div className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ['vatReturnSales', data.summary.salesValue],
                  ['vatReturnOutputTax', data.summary.outputVat],
                  ['vatReturnPurchases', data.summary.purchasesValue],
                  ['vatReturnInputTax', data.summary.inputVat],
                  ['vatReturnNet', data.summary.netVat],
                  ['vatReturnWithholding', data.summary.withholdingOutput],
                ] as const
              ).map(([labelKey, value]) => (
                <div
                  key={labelKey}
                  className="rounded-md border border-border bg-surface px-token-md py-token-sm"
                >
                  <div className="text-xs text-muted">{t(labelKey)}</div>
                  <div className="text-lg font-semibold tabular-nums" dir="ltr">
                    {formatMoneyDisplay(value)}
                  </div>
                </div>
              ))}
              {data.summary.position ? (
                <div className="rounded-md border border-border bg-surface px-token-md py-token-sm">
                  <div className="text-xs text-muted">{t('position')}</div>
                  <div className="text-lg font-semibold">
                    {t(`positions.${String(data.summary.position)}`)}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {(
            [
              ['vatReturnOutputSection', 'output'],
              ['vatReturnInputSection', 'input'],
              ['vatReturnWithholdingSection', 'withholding'],
            ] as const
          ).map(([titleKey, sectionKey]) => {
            const rows =
              (data.sections?.[sectionKey] as
                | Array<Record<string, unknown>>
                | undefined) ??
              (data.rows ?? []).filter((r) =>
                sectionKey === 'withholding'
                  ? r.category === 'withholding'
                  : r.side === sectionKey,
              );
            if (!rows.length) return null;
            return (
              <section
                key={sectionKey}
                className="overflow-x-auto rounded-md border border-border"
              >
                <h3 className="border-b border-border bg-surface px-3 py-2 text-sm font-medium">
                  {t(titleKey)}
                </h3>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-border px-3 py-2 text-start">
                        {t('colTaxType')}
                      </th>
                      <th className="border-b border-border px-3 py-2 text-start">
                        {t('colSubType')}
                      </th>
                      <th className="border-b border-border px-3 py-2 text-start">
                        {t('colRate')}
                      </th>
                      <th className="border-b border-border px-3 py-2 text-start">
                        {t('colTaxable')}
                      </th>
                      <th className="border-b border-border px-3 py-2 text-start">
                        {t('colTaxAmount')}
                      </th>
                      <th className="border-b border-border px-3 py-2 text-start">
                        {t('colDocs')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const taxLabel = pickLocaleName(
                        locale,
                        row.taxTypeNameEn,
                        row.taxTypeNameAr,
                        row.taxType,
                      );
                      const subLabel = pickLocaleName(
                        locale,
                        row.subTypeNameEn,
                        row.subTypeNameAr,
                        row.subType,
                      );
                      const taxCode = String(row.taxType ?? '');
                      const subCode = String(row.subType ?? '');
                      return (
                      <tr
                        key={`${sectionKey}-${i}`}
                        className="odd:bg-background even:bg-surface/40"
                      >
                        <td className="border-b border-border px-3 py-2">
                          {taxLabel && taxCode && taxLabel !== taxCode
                            ? `${taxLabel} `
                            : null}
                          <span dir="ltr">
                            {taxLabel !== taxCode ? `(${taxCode})` : taxCode}
                          </span>
                        </td>
                        <td className="border-b border-border px-3 py-2">
                          {subCode ? (
                            <>
                              {subLabel && subLabel !== subCode
                                ? `${subLabel} `
                                : null}
                              <span dir="ltr">
                                {subLabel !== subCode
                                  ? `(${subCode})`
                                  : subCode}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          className="border-b border-border px-3 py-2 tabular-nums"
                          dir="ltr"
                        >
                          {String(row.rate ?? '')}
                        </td>
                        <td
                          className="border-b border-border px-3 py-2 tabular-nums"
                          dir="ltr"
                        >
                          {formatMoneyDisplay(row.taxableValue)}
                        </td>
                        <td
                          className="border-b border-border px-3 py-2 tabular-nums"
                          dir="ltr"
                        >
                          {formatMoneyDisplay(row.taxAmount)}
                        </td>
                        <td
                          className="border-b border-border px-3 py-2 tabular-nums"
                          dir="ltr"
                        >
                          {String(row.documentCount ?? '')}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </>
      ) : null}

      {data && reportId !== 'C4' ? (
        <>
          <section className="grid gap-token-sm sm:grid-cols-2 lg:grid-cols-4">
            {summaryEntries.map(([k, v]) => (
              <div
                key={k}
                className="rounded-md border border-border bg-surface px-token-md py-token-sm"
              >
                <div className="text-xs text-muted">{fieldLabel(k)}</div>
                <div className="text-lg font-semibold tabular-nums" dir="ltr">
                  {typeof v === 'number' ||
                  (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))
                    ? /count|Count$/i.test(k) || k === 'rate'
                      ? formatQuantityDisplay(v)
                      : formatMoneyDisplay(v)
                    : String(v ?? '—')}
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
                        <Line type="monotone" dataKey="sales" stroke="#0f766e" name={t('fields.sales')} />
                        <Line
                          type="monotone"
                          dataKey="purchases"
                          stroke="#b45309"
                          name={t('fields.purchases')}
                        />
                      </>
                    ) : (
                      <Line type="monotone" dataKey="net" stroke="#0f766e" name={t('fields.net')} />
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
                              ? 'itemName'
                              : reportId === 'C1'
                                ? 'name'
                                : reportId === 'C3'
                                  ? 'status'
                                  : reportId === 'S4' || reportId === 'P3'
                                    ? 'taxType'
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
                      name={t('fields.amount')}
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
                  {Object.keys(tableRows[0] ?? { empty: '' }).map((col) => (
                    <th
                      key={col}
                      className="border-b border-border px-3 py-2 text-start font-medium"
                    >
                      {fieldLabel(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i} className="odd:bg-background even:bg-surface/40">
                    {Object.keys(tableRows[0] ?? {}).map((col) => (
                      <td
                        key={col}
                        className="border-b border-border px-3 py-2 tabular-nums"
                        dir={
                          col === 'itemCode' ||
                          col === 'currency' ||
                          col === 'currencyCode' ||
                          col === 'rate'
                            ? 'ltr'
                            : undefined
                        }
                      >
                        {cellDisplayValue(col, row[col], branchLabels)}
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
