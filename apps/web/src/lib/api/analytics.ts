import { apiFetch } from './client';

export type MeterTotals = {
  issued: number;
  received: number;
  valid: number;
  invalid: number;
  api_calls: number;
  storage_bytes: number;
};

export type AnalyticsSummary = {
  from: string;
  to: string;
  timezone: string;
  asOf: string;
  filters: { branchId: string | null; currencyCode: string | null };
  totals: MeterTotals;
  notes: string[];
};

export type UsageExportJob = {
  id: string;
  status: string;
  format: string;
};

export function fetchAnalyticsSummary(params: {
  from: string;
  to: string;
  branchId?: string;
  currencyCode?: string;
}) {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.currencyCode) q.set('currencyCode', params.currencyCode);
  return apiFetch<AnalyticsSummary>(`/analytics/summary?${q.toString()}`, {
    tenantScoped: true,
  });
}

export function fetchAnalyticsSeries(params: {
  from: string;
  to: string;
  grain: 'day' | 'month';
  branchId?: string;
  currencyCode?: string;
}) {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    grain: params.grain,
  });
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.currencyCode) q.set('currencyCode', params.currencyCode);
  return apiFetch<{
    grain: string;
    timezone: string;
    points: Array<{ bucket: string; values: MeterTotals }>;
  }>(`/analytics/series?${q.toString()}`, { tenantScoped: true });
}

export function createAnalyticsExport(body: {
  format: 'CSV' | 'XLSX';
  from: string;
  to: string;
  branchId?: string;
  currencyCode?: string;
  grain?: 'day' | 'month';
}) {
  return apiFetch<UsageExportJob>('/analytics/exports', {
    method: 'POST',
    body,
    tenantScoped: true,
  });
}

export async function downloadAnalyticsExport(jobId: string) {
  const job = await apiFetch<UsageExportJob>(`/analytics/exports/${jobId}`, {
    tenantScoped: true,
  });
  if (job.status !== 'READY') {
    throw new Error(`Export status ${job.status}`);
  }
  const { apiBase } = await import('./client');
  const { getAccessToken, getActiveTenantId } = await import('@/lib/session');
  const res = await fetch(
    `${apiBase()}/analytics/exports/${jobId}/download`,
    {
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${getAccessToken() ?? ''}`,
        'X-Tenant-Id': getActiveTenantId() ?? '',
      },
    },
  );
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    job.format === 'XLSX'
      ? `usage-${jobId}.xlsx`
      : `usage-${jobId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function fetchBranchesForFilter() {
  return apiFetch<Array<{ id: string; name: string }>>('/branches', {
    tenantScoped: true,
  });
}
