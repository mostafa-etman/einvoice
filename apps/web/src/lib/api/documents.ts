import { apiFetch } from './client';

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
    issues: Array<{
      code: string;
      path?: string;
      severity?: 'error' | 'warning';
      message: string;
      messageKey?: string;
    }>;
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
