import { apiBase, apiFetch, ApiError } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type ExportJob = {
  id: string;
  kind: 'LOCAL' | 'ETA_PACKAGE';
  status: string;
  formatsJson?: string[];
  filtersJson?: Record<string, unknown>;
  expiresAt?: string | null;
  errorSummary?: string | null;
  createdAt: string;
  etaPackage?: {
    etaRequestId: string;
    localStatus: string;
    etaStatusRaw: number | null;
    readyAt: string | null;
  } | null;
};

export async function listExportJobs(kind?: string) {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return apiFetch<{ items: ExportJob[] }>(`/exports/jobs${q}`, {
    tenantScoped: true,
  });
}

export async function getExportJob(jobId: string) {
  return apiFetch<ExportJob>(`/exports/jobs/${jobId}`, { tenantScoped: true });
}

export async function createLocalExport(body: {
  formats: Array<'CSV' | 'XLSX' | 'PDF' | 'JSON'>;
  filters: {
    from?: string;
    to?: string;
    documentTypes?: string[];
    statuses?: string[];
    branchId?: string;
  };
}) {
  return apiFetch<ExportJob>('/exports/local', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export async function createEtaPackageExport(body: {
  dateFrom: string;
  dateTo: string;
  documentTypeNames?: string[];
  statuses?: string[];
  type?: 'full' | 'summary';
  format?: 'JSON' | 'XML' | 'CSV';
}) {
  return apiFetch<ExportJob>('/exports/packages', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export async function downloadExportArtifact(jobId: string, format?: string) {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const q = format ? `?format=${encodeURIComponent(format)}` : '';
  const res = await fetch(`${apiBase()}/exports/jobs/${jobId}/download${q}`, {
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
  });
  if (!res.ok) throw new ApiError('Download failed', res.status);
  return res.blob();
}
