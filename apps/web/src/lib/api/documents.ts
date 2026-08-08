import { apiFetch, apiBase, ApiError } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type DocumentKind =
  | 'INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'EXPORT_INVOICE'
  | 'EXPORT_CREDIT_NOTE'
  | 'EXPORT_DEBIT_NOTE';

export type AddressInput = {
  branchId?: string;
  country?: string;
  governate?: string;
  regionCity?: string;
  street?: string;
  buildingNumber?: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
};

export type DocumentUpsert = {
  kind: DocumentKind;
  branchId: string;
  currencyCode: string;
  issueDateTime: string;
  internalId: string;
  version: number;
  taxpayerActivityCode?: string;
  purchaseOrderReference?: string;
  purchaseOrderDescription?: string;
  salesOrderReference?: string;
  salesOrderDescription?: string;
  proformaInvoiceNumber?: string;
  serviceDeliveryDate?: string;
  issuer?: {
    type?: string;
    id?: string;
    name?: string;
    address?: AddressInput;
  };
  receiver?: {
    type?: string;
    id?: string;
    name?: string;
    address?: AddressInput;
  };
  payment?: {
    bankName?: string;
    bankAddress?: string;
    bankAccountNo?: string;
    bankAccountIBAN?: string;
    swiftCode?: string;
    terms?: string;
  } | null;
  delivery?: {
    approach?: string;
    packaging?: string;
    dateValidity?: string;
    exportPort?: string;
    countryOfOrigin?: string;
    grossWeight?: string;
    netWeight?: string;
    terms?: string;
  } | null;
  references?: string[] | Record<string, unknown> | null;
  extraDiscountAmount?: string;
  lines: Array<{
    description: string;
    itemType: string;
    itemCode: string;
    unitType: string;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    discountRate?: string;
    currencySold?: string;
    amountEGP?: string;
    amountSold?: string;
    currencyExchangeRate?: string;
    internalCode?: string;
    weightUnitType?: string;
    weightQuantity?: string;
    taxes?: Array<{
      taxType: string;
      subType: string;
      rate: string;
      /** Required for fixed-amount types (T3, T6); ignored for rate-based. */
      amount?: string;
    }>;
  }>;
};

export type DocumentListItem = {
  id: string;
  kind: string;
  status: string;
  origin: string;
  internalId: string;
  issueDateTime: string;
  currencyCode: string;
  totalAmount: string;
  receiverName: string | null;
  receiverId: string | null;
  updatedAt: string;
  needsAttention: boolean;
  needsAttentionReason: string | null;
  submissionUuid: string | null;
  etaUuid: string | null;
  etaLongId: string | null;
  etaStatus: string | null;
  etaStatusUpdatedAt: string | null;
  submitInFlight: boolean;
  submitCooldownUntil: string | null;
};

export function listDocuments(params?: {
  status?: string;
  kind?: string;
  from?: string;
  to?: string;
  receiver?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.kind) q.set('kind', params.kind);
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  if (params?.receiver) q.set('receiver', params.receiver);
  if (params?.q) q.set('q', params.q);
  if (params?.cursor) q.set('cursor', params.cursor);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.sortBy) q.set('sortBy', params.sortBy);
  if (params?.sortDir) q.set('sortDir', params.sortDir);
  const qs = q.toString();
  return apiFetch<{ items: DocumentListItem[]; nextCursor: string | null }>(
    `/documents${qs ? `?${qs}` : ''}`,
    { tenantScoped: true },
  );
}

export type SalesSyncRun = {
  id: string | null;
  trigger: string | null;
  status: string | null;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export function syncSales(range?: { from?: string; to?: string }) {
  return apiFetch<SalesSyncRun>('/documents/sync', {
    method: 'POST',
    tenantScoped: true,
    body: range?.from || range?.to ? range : undefined,
  });
}

export function latestSalesSync() {
  return apiFetch<SalesSyncRun>('/documents/sync/latest', {
    tenantScoped: true,
  });
}

export function resetSalesSync() {
  return apiFetch<{ releasedCount: number; latest: SalesSyncRun }>(
    '/documents/sync/reset',
    { method: 'POST', tenantScoped: true },
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

export type ValidationIssue = {
  code: string;
  path?: string;
  severity?: 'error' | 'warning';
  message: string;
  messageKey?: string;
  /** Company-level problems are fixed in Settings, not on the invoice. */
  fixIn?: 'settings';
  settingsArea?: 'branches';
};

export function validateDocument(id: string) {
  return apiFetch<{
    ok: boolean;
    issues: ValidationIssue[];
  }>(`/documents/${id}/validate`, { method: 'POST', tenantScoped: true });
}

export function recalculateDocumentTotals(id: string) {
  return apiFetch<Record<string, unknown>>(`/documents/${id}/recalculate-totals`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export function recalculateAllDraftTotals() {
  return apiFetch<{
    attempted: number;
    succeeded: number;
    failed: number;
    results: Array<{ id: string; ok: boolean; totalAmount?: string; error?: string }>;
  }>('/documents/recalculate-totals', {
    method: 'POST',
    tenantScoped: true,
  });
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

export function submitDocumentToEta(id: string, idempotencyKey?: string) {
  return apiFetch<{
    id: string;
    state: string;
    etaSubmissionUuid: string | null;
    acceptedCount: number;
    refusedCount: number;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    nextAttemptAt: string | null;
    isTransientCooldown: boolean;
    etaRawResponse: unknown;
    documents: Array<{
      documentId: string;
      internalId: string;
      attemptOutcome: string;
      etaUuid: string | null;
      intakeError: unknown;
      documentStatus: string;
    }>;
  }>(`/documents/${id}/submit`, {
    method: 'POST',
    tenantScoped: true,
    headers: idempotencyKey
      ? { 'Idempotency-Key': idempotencyKey }
      : undefined,
  });
}
export function resetDocumentSubmitCooldown(id: string) {
  return apiFetch<{
    documentId: string;
    submitCooldownUntil: null;
    submitInFlight: boolean;
    submitAttemptCount: number;
    submitAttemptLog: unknown;
    message: string;
  }>(`/documents/${id}/submit/reset-cooldown`, {
    method: 'POST',
    tenantScoped: true,
  });
}

async function readPdfDownload(res: Response, fallbackName: string) {
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
  return { blob, filename: match?.[1] ?? fallbackName };
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/pdf' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenantId = getActiveTenantId();
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  return headers;
}

/** Local pre-submission printable PDF for a saved document. */
export async function downloadLocalPrintout(id: string, locale?: string) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const res = await fetch(`${apiBase()}/documents/${id}/local-printout${q}`, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(),
  });
  return readPdfDownload(res, `invoice-${id}-preview.pdf`);
}

/** Local printable PDF from current (possibly unsaved) form body. */
export async function downloadLocalPrintoutFromBody(
  body: DocumentUpsert,
  locale?: string,
) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const res = await fetch(`${apiBase()}/documents/local-printout${q}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return readPdfDownload(res, `invoice-${body.internalId || 'draft'}-preview.pdf`);
}
