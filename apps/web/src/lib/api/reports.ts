import { apiFetch, apiBase } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type ReportId =
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S4'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'C1'
  | 'C2'
  | 'C3';

export type ReportFiltersInput = {
  from: string;
  to: string;
  branchId?: string;
  currencyCode?: string;
  perCurrency?: boolean;
  includeNonFinancialStatuses?: boolean;
  showGross?: boolean;
  grain?: 'day' | 'month';
  perBranch?: boolean;
  limit?: number;
};

export type ReportPayload = {
  reportId: ReportId;
  filters: Record<string, unknown>;
  summary: Record<string, unknown>;
  series?: Array<Record<string, unknown>>;
  rows?: Array<Record<string, unknown>>;
  chart?: Record<string, unknown>;
  vat?: unknown;
  total?: Record<string, unknown>;
};

export const REPORT_CATALOG: Array<{
  id: ReportId;
  group: 'sales' | 'purchases' | 'combined';
}> = [
  { id: 'S1', group: 'sales' },
  { id: 'S2', group: 'sales' },
  { id: 'S3', group: 'sales' },
  { id: 'S4', group: 'sales' },
  { id: 'P1', group: 'purchases' },
  { id: 'P2', group: 'purchases' },
  { id: 'P3', group: 'purchases' },
  { id: 'C1', group: 'combined' },
  { id: 'C2', group: 'combined' },
  { id: 'C3', group: 'combined' },
];

function qs(params: ReportFiltersInput): string {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.currencyCode) q.set('currencyCode', params.currencyCode);
  if (params.perCurrency) q.set('perCurrency', 'true');
  if (params.includeNonFinancialStatuses) {
    q.set('includeNonFinancialStatuses', 'true');
  }
  if (params.showGross) q.set('showGross', 'true');
  if (params.grain) q.set('grain', params.grain);
  if (params.perBranch) q.set('perBranch', 'true');
  if (params.limit) q.set('limit', String(params.limit));
  return q.toString();
}

export function fetchReport(reportId: ReportId, params: ReportFiltersInput) {
  return apiFetch<ReportPayload>(`/reports/${reportId}?${qs(params)}`, {
    tenantScoped: true,
  });
}

export async function downloadReportExport(
  reportId: ReportId,
  format: 'CSV' | 'XLSX' | 'PDF',
  params: ReportFiltersInput,
) {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const res = await fetch(`${apiBase()}/reports/${reportId}/export`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
    body: JSON.stringify({ format, ...params }),
  });
  if (!res.ok) {
    throw new Error(`Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${reportId}.${format.toLowerCase()}`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchBranchesForFilter() {
  const list = await apiFetch<Array<{ id: string; name: string }>>(
    '/branches',
    { tenantScoped: true },
  );
  return list.map((b) => ({ id: b.id, name: b.name }));
}
