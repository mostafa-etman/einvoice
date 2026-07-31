import { apiBase, apiFetch, ApiError } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type ImportJob = {
  id: string;
  status: string;
  documentType: string;
  runMode: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdDocs: number;
  signEnqueued: number;
  failedRows: number;
  sourceFileName: string;
  errorReportAvailable?: boolean;
  mappingJson?: Record<string, string> | null;
  createdAt: string;
};

export type ImportRow = {
  id: string;
  rowNumber: number;
  businessKey: string | null;
  status: string;
  errorsJson: Array<{ field: string; code: string; message: string }>;
  documentId: string | null;
};

export async function listImportJobs() {
  return apiFetch<{ items: ImportJob[] }>('/imports/jobs', { tenantScoped: true });
}

export async function getImportJob(jobId: string) {
  return apiFetch<ImportJob>(`/imports/jobs/${jobId}`, { tenantScoped: true });
}

export async function listImportRows(jobId: string, status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<{ items: ImportRow[] }>(`/imports/jobs/${jobId}/rows${q}`, {
    tenantScoped: true,
  });
}

export async function uploadImportFile(args: {
  file: File;
  documentType: string;
  branchId?: string;
}) {
  const form = new FormData();
  form.append('file', args.file);
  form.append('documentType', args.documentType);
  if (args.branchId) form.append('branchId', args.branchId);

  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const res = await fetch(`${apiBase()}/imports/jobs`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError('Upload failed', res.status, body);
  }
  return (await res.json()) as ImportJob;
}

export async function putImportMapping(
  jobId: string,
  fields: Record<string, string>,
) {
  return apiFetch<ImportJob>(`/imports/jobs/${jobId}/mapping`, {
    method: 'PUT',
    tenantScoped: true,
    body: { fields },
  });
}

export async function validateImportJob(jobId: string) {
  return apiFetch<ImportJob>(`/imports/jobs/${jobId}/validate`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export async function runImportJob(
  jobId: string,
  runMode: 'CREATE_ONLY' | 'CREATE_SIGN_SUBMIT',
) {
  return apiFetch<ImportJob>(`/imports/jobs/${jobId}/run`, {
    method: 'POST',
    tenantScoped: true,
    body: { runMode },
  });
}

export function importTemplateUrl(documentType: string, format: 'csv' | 'xlsx') {
  return `${apiBase()}/imports/templates/${encodeURIComponent(documentType)}?format=${format}`;
}

export async function downloadImportTemplate(
  documentType: string,
  format: 'csv' | 'xlsx',
) {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const res = await fetch(importTemplateUrl(documentType, format), {
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
  });
  if (!res.ok) throw new ApiError('Template download failed', res.status);
  return res.blob();
}

export async function downloadImportErrorReport(jobId: string) {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const res = await fetch(`${apiBase()}/imports/jobs/${jobId}/error-report`, {
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
  });
  if (!res.ok) throw new ApiError('Error report download failed', res.status);
  return res.blob();
}
