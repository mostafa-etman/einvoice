import { apiBase, apiFetch, ApiError } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

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
  isChainTip?: boolean;
  canReturn?: boolean;
};

export type ReceiptBuyerWrite = {
  type: 'P' | 'B' | 'F';
  id?: string;
  name?: string;
  mobileNumber?: string;
  paymentNumber?: string;
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
  commercialDiscountData?: Array<{ amount?: string; description?: string; rate?: string }>;
};

export type ReceiptWrite = {
  branchId: string;
  posDeviceId?: string;
  receiptType?: string;
  receiptNumber?: string;
  dateTimeIssued: string;
  currencyCode?: string;
  exchangeRate?: string | number;
  referenceUUID?: string;
  orderdeliveryMode?: string;
  paymentMethod: string;
  buyer: ReceiptBuyerWrite;
  lines: ReceiptLineWrite[];
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
  form?: ReceiptWrite;
};

export type ReceiptValidationIssue = {
  code: string;
  path: string;
  severity: 'error' | 'warning';
  messageKey: string;
  params?: Record<string, string>;
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
    taxTotals?: Array<{ taxType: string; amount: string }>;
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

export function updateReceipt(id: string, body: ReceiptWrite) {
  return apiFetch<ReceiptDetail>(`/receipts/${id}`, {
    method: 'PUT',
    tenantScoped: true,
    body,
  });
}

export function createReturnReceipt(id: string) {
  return apiFetch<ReceiptDetail>(`/receipts/${id}/return`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export function deleteReceipt(id: string) {
  return apiFetch<{ ok: boolean }>(`/receipts/${id}`, {
    method: 'DELETE',
    tenantScoped: true,
  });
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/pdf' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenantId = getActiveTenantId();
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  return headers;
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

export async function downloadReceiptLocalPrintoutFromBody(
  body: ReceiptWrite,
  locale?: string,
) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const res = await fetch(`${apiBase()}/receipts/local-printout${q}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return readPdfDownload(res, `receipt-${body.receiptNumber || 'draft'}-preview.pdf`);
}
