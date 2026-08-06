import { apiFetch, apiBase, ApiError } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type BatchSubmitItemResult = {
  documentId: string;
  internalId: string | null;
  outcome: 'sent' | 'skipped' | 'failed';
  reason?: string;
  attemptOutcome?: string;
  etaUuid?: string | null;
  documentStatus: string | null;
  intakeError?: unknown;
};

export type BatchSubmitResult = {
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
  submissionId: string | null;
  submission: Record<string, unknown> | null;
  lateWarnings: Array<{
    documentId: string;
    internalId: string;
    issueDateTime: string;
    ageDays: number;
    warnDays: number;
    isLate: boolean;
  }>;
  results: BatchSubmitItemResult[];
};

export type StatusRefreshItemResult = {
  documentId: string;
  internalId: string;
  outcome: 'updated' | 'unchanged' | 'skipped' | 'failed';
  reason?: string;
  previousStatus: string | null;
  status: string | null;
  etaStatus: string | null;
  etaStatusUpdatedAt: string | null;
};

export type StatusRefreshBatchResult = {
  requested: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  results: StatusRefreshItemResult[];
};

/** Multi-select send — reuses the Phase 6 batch submission pipeline. */
export function createSubmission(
  documentIds: string[],
  idempotencyKey?: string,
) {
  const key =
    idempotencyKey && idempotencyKey.length >= 8
      ? idempotencyKey
      : `batch-ui:${[...documentIds].sort().join(',').slice(0, 80)}:${Date.now()}`;
  return apiFetch<BatchSubmitResult>('/submissions', {
    method: 'POST',
    tenantScoped: true,
    body: { documentIds },
    headers: { 'Idempotency-Key': key },
  });
}

export function getSubmission(id: string) {
  return apiFetch<Record<string, unknown>>(`/submissions/${id}`, {
    tenantScoped: true,
  });
}

export function refreshDocumentStatus(id: string) {
  return apiFetch<StatusRefreshItemResult>(`/documents/${id}/refresh-status`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export function refreshDocumentsStatus(opts: {
  documentIds?: string[];
  pendingOnly?: boolean;
}) {
  return apiFetch<StatusRefreshBatchResult>('/documents/refresh-status', {
    method: 'POST',
    tenantScoped: true,
    body: opts,
  });
}

export function cancelDocument(id: string, reason: string) {
  return apiFetch<{ id: string; status: string; etaUuid: string | null }>(
    `/documents/${id}/cancel`,
    {
      method: 'POST',
      tenantScoped: true,
      body: { reason },
    },
  );
}

export function cancelDocumentsSelected(documentIds: string[], reason: string) {
  return apiFetch<{
    requested: number;
    cancelled: number;
    skipped: number;
    failed: number;
    results: Array<{
      documentId: string;
      internalId: string | null;
      outcome: string;
      reason?: string;
      status?: string | null;
    }>;
  }>('/documents/cancel-selected', {
    method: 'POST',
    tenantScoped: true,
    body: { documentIds, reason },
  });
}

export function declineDocumentRejection(id: string) {
  return apiFetch<{ id: string; etaUuid: string | null }>(
    `/documents/${id}/decline-rejection`,
    { method: 'POST', tenantScoped: true },
  );
}

export async function downloadDocumentPrintout(id: string) {
  const headers: Record<string, string> = { Accept: 'application/pdf' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenantId = getActiveTenantId();
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  const res = await fetch(`${apiBase()}/documents/${id}/printout`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = res.statusText;
    try {
      const data = text ? (JSON.parse(text) as { message?: string }) : null;
      if (data?.message) message = String(data.message);
    } catch {
      if (text) message = text.slice(0, 300);
    }
    throw new ApiError(message, res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(cd);
  return { blob, filename: match?.[1] ?? `document-${id}.pdf` };
}

export function getDocumentEtaSource(id: string) {
  return apiFetch<{
    documentId: string;
    internalId: string;
    etaUuid: string;
    contentType: string;
    body: unknown;
    bodyText: string;
  }>(`/documents/${id}/eta-source`, { tenantScoped: true });
}

/** Fetch ETA Get Document (raw) and return a downloadable blob. */
export async function downloadDocumentEtaSource(id: string) {
  const src = await getDocumentEtaSource(id);
  const isXml =
    src.contentType.includes('xml') || src.bodyText.trimStart().startsWith('<');
  const blob = new Blob([src.bodyText], {
    type: isXml ? 'application/xml' : 'application/json',
  });
  return {
    blob,
    filename: `eta-source-${src.internalId || id}.${isXml ? 'xml' : 'json'}`,
    src,
  };
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
