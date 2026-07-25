import { apiFetch } from './client';

export type DocumentKind =
  | 'INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'EXPORT_INVOICE'
  | 'EXPORT_CREDIT_NOTE'
  | 'EXPORT_DEBIT_NOTE';

export type DocumentUpsert = {
  kind: DocumentKind;
  branchId: string;
  currencyCode: string;
  issueDateTime: string;
  internalId: string;
  version: number;
  receiver?: { type?: string; id?: string; name?: string };
  references?: Record<string, unknown> | null;
  extraDiscountAmount?: string;
  lines: Array<{
    description: string;
    itemType: string;
    itemCode: string;
    unitType: string;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    taxes?: Array<{ taxType: string; subType: string; rate: string }>;
  }>;
};

export function listDocuments(params?: { status?: string; kind?: string }) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.kind) q.set('kind', params.kind);
  const qs = q.toString();
  return apiFetch<{ items: Array<Record<string, unknown>> }>(
    `/documents${qs ? `?${qs}` : ''}`,
    { tenantScoped: true },
  );
}

export function getDocument(id: string) {
  return apiFetch<Record<string, unknown>>(`/documents/${id}`, {
    tenantScoped: true,
  });
}

export function createDocument(body: DocumentUpsert) {
  return apiFetch<Record<string, unknown>>('/documents', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export function updateDocument(id: string, body: DocumentUpsert) {
  return apiFetch<Record<string, unknown>>(`/documents/${id}`, {
    method: 'PUT',
    tenantScoped: true,
    body,
  });
}

export function deleteDocument(id: string) {
  return apiFetch<void>(`/documents/${id}`, {
    method: 'DELETE',
    tenantScoped: true,
  });
}

export function previewDocument(body: DocumentUpsert) {
  return apiFetch<{
    etaPayload: Record<string, unknown>;
    canonicalString: string;
    totals: Record<string, unknown>;
  }>('/documents/preview', { method: 'POST', tenantScoped: true, body });
}

export function validateDocument(id: string) {
  return apiFetch<{
    ok: boolean;
    issues: Array<{ code: string; message: string }>;
  }>(`/documents/${id}/validate`, { method: 'POST', tenantScoped: true });
}

export function markDocumentReady(id: string) {
  return apiFetch<Record<string, unknown>>(`/documents/${id}/mark-ready`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export function sendDocumentForSignature(id: string) {
  return apiFetch<Record<string, unknown>>(`/documents/${id}/send-for-signature`, {
    method: 'POST',
    tenantScoped: true,
  });
}
