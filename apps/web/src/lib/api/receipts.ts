import { apiFetch } from './client';

export type ReceiptListItem = {
  id: string;
  status: string;
  receiptType: string;
  receiptNumber: string;
  dateTimeIssued: string;
  uuid: string;
  previousUuid: string;
  totalAmount: string;
  paymentMethod: string;
  branchId: string;
  posDeviceId: string;
  buyerType: string;
  buyerName: string | null;
};

export type ReceiptDetail = ReceiptListItem & {
  typeVersion: string;
  currencyCode: string;
  exchangeRate: string;
  referenceUuid: string | null;
  orderDeliveryMode: string | null;
  buyerId: string | null;
  totalSales: string;
  netAmount: string;
  etaPayload: unknown;
  etaPayloadText: string;
  uuidCanonicalString: string;
  canonicalString: string;
};

export type ReceiptValidationIssue = {
  code: string;
  path: string;
  severity: 'error' | 'warning';
  messageKey: string;
  params?: Record<string, string>;
};

export type ReceiptLineWrite = {
  internalCode: string;
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  quantity: string;
  unitPrice: string;
  taxes?: Array<{ taxType: string; subType: string; rate: string; amount?: string }>;
};

export type ReceiptWrite = {
  branchId: string;
  posDeviceId: string;
  receiptType?: string;
  receiptNumber?: string;
  dateTimeIssued: string;
  currencyCode?: string;
  referenceUUID?: string;
  orderdeliveryMode?: string;
  paymentMethod: string;
  buyer: {
    type: 'P' | 'B' | 'F';
    id?: string;
    name?: string;
    mobileNumber?: string;
    paymentNumber?: string;
  };
  lines: ReceiptLineWrite[];
};

export type ReceiptPreview = {
  etaPayload: unknown;
  uuid: string;
  previousUUID: string;
  uuidCanonicalString: string;
  canonicalString: string;
  totals: {
    totalSales: string;
    netAmount: string;
    totalAmount: string;
    totalCommercialDiscount: string;
    totalItemsDiscount: string;
  };
  issues: ReceiptValidationIssue[];
};

export function listReceipts(opts?: { posDeviceId?: string; branchId?: string }) {
  const params = new URLSearchParams();
  if (opts?.posDeviceId) params.set('posDeviceId', opts.posDeviceId);
  if (opts?.branchId) params.set('branchId', opts.branchId);
  const q = params.toString() ? `?${params}` : '';
  return apiFetch<ReceiptListItem[]>(`/receipts${q}`, { tenantScoped: true });
}

export function previewReceipt(body: ReceiptWrite) {
  return apiFetch<ReceiptPreview>('/receipts/preview', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export function createReceipt(body: ReceiptWrite) {
  return apiFetch<ReceiptDetail>('/receipts', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export function getReceipt(id: string) {
  return apiFetch<ReceiptDetail>(`/receipts/${id}`, { tenantScoped: true });
}

export function deleteReceipt(id: string) {
  return apiFetch<{ ok: boolean }>(`/receipts/${id}`, {
    method: 'DELETE',
    tenantScoped: true,
  });
}
