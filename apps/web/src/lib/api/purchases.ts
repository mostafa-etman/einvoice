import { apiBase, apiFetch } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type PurchaseSummary = {
  id: string;
  documentUuid: string;
  etaLongId: string | null;
  internalId: string | null;
  kind: string;
  etaDocumentType: string;
  etaStatus: string | null;
  dateTimeIssued: string | null;
  issuerName: string | null;
  totalAmount: string | null;
  currency: string | null;
  buyerDecision: string;
  reconciliationStatus: string;
  branchId: string | null;
  needsAttention: boolean;
  lastSyncedAt: string;
};

export type PurchaseLine = {
  id?: string;
  lineNumber?: number | null;
  description?: string | null;
  itemCode?: string | null;
  itemType?: string | null;
  unitType?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  netTotal?: string | null;
  total?: string | null;
  taxesJson?: unknown;
  taxes?: unknown;
  rawJson?: unknown;
};

export type PurchaseDetail = PurchaseSummary & {
  issuerType?: string | null;
  issuerId?: string | null;
  netAmount?: string | null;
  issuerJson?: unknown;
  receiverJson?: unknown;
  lines?: PurchaseLine[];
  buyerDecisionReason?: string | null;
  reconciliationNote?: string | null;
  purchaseOrderLinkId?: string | null;
  rawDetailsJson?: unknown;
  printoutAvailable?: boolean;
  needsAttentionReason?: string | null;
};

export type SyncRun = {
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

export function listPurchases(params?: {
  from?: string;
  to?: string;
  branchId?: string;
  kind?: string;
  buyerDecision?: string;
  reconciliationStatus?: string;
  q?: string;
}) {
  const q = new URLSearchParams();
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  if (params?.branchId) q.set('branchId', params.branchId);
  if (params?.kind) q.set('kind', params.kind);
  if (params?.buyerDecision) q.set('buyerDecision', params.buyerDecision);
  if (params?.reconciliationStatus) {
    q.set('reconciliationStatus', params.reconciliationStatus);
  }
  if (params?.q) q.set('q', params.q);
  const qs = q.toString();
  return apiFetch<{ items: PurchaseSummary[]; nextCursor: string | null }>(
    `/purchases${qs ? `?${qs}` : ''}`,
    { tenantScoped: true },
  );
}

export function getPurchase(id: string) {
  return apiFetch<PurchaseDetail>(`/purchases/${id}`, { tenantScoped: true });
}

export function syncPurchases() {
  return apiFetch<SyncRun>('/purchases/sync', {
    method: 'POST',
    tenantScoped: true,
  });
}

export function latestPurchaseSync() {
  return apiFetch<SyncRun>('/purchases/sync/latest', { tenantScoped: true });
}

export function acceptPurchase(id: string) {
  return apiFetch<PurchaseDetail>(`/purchases/${id}/accept`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export function rejectPurchase(id: string, reason: string) {
  return apiFetch<PurchaseDetail>(`/purchases/${id}/reject`, {
    method: 'POST',
    tenantScoped: true,
    body: { reason },
  });
}

export function declinePurchaseCancelation(id: string) {
  return apiFetch<PurchaseDetail>(`/purchases/${id}/decline-cancelation`, {
    method: 'POST',
    tenantScoped: true,
  });
}

export function patchPurchase(
  id: string,
  body: {
    branchId?: string | null;
    reconciliationStatus?: string;
    reconciliationNote?: string | null;
  },
) {
  return apiFetch<PurchaseDetail>(`/purchases/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body,
  });
}

async function downloadPurchasePdf(
  path: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const res = await fetch(`${apiBase()}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      Accept: 'application/pdf',
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error((await res.text()) || res.statusText);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob, filename: match?.[1] ?? fallbackName };
}

export function downloadPurchasePrintout(id: string) {
  return downloadPurchasePdf(`/purchases/${id}/printout`, `purchase-${id}.pdf`);
}

export function downloadPurchaseLocalPrintout(id: string, locale?: string) {
  const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return downloadPurchasePdf(
    `/purchases/${id}/local-printout${q}`,
    `purchase-${id}-preview.pdf`,
  );
}

export function purchasePrintoutUrl(id: string) {
  return `/purchases/${id}/printout`;
}
