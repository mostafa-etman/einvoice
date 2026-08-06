import { apiFetch } from './client';

export type InvoiceNumbering = {
  prefix: string;
  padWidth: number;
  startingNumber: number;
  charset: 'NUMERIC' | 'ALPHANUMERIC';
  scope: 'TENANT' | 'BRANCH' | 'DOCUMENT_KIND' | 'BRANCH_AND_KIND';
  previewNext: string;
};

export function getInvoiceNumbering() {
  return apiFetch<InvoiceNumbering>('/settings/invoice-numbering', {
    tenantScoped: true,
  });
}

export function upsertInvoiceNumbering(body: {
  prefix: string;
  padWidth: number;
  startingNumber: number;
  charset: InvoiceNumbering['charset'];
  scope: InvoiceNumbering['scope'];
}) {
  return apiFetch<InvoiceNumbering>('/settings/invoice-numbering', {
    method: 'PUT',
    tenantScoped: true,
    body,
  });
}

export function allocateNextInternalId(opts?: {
  branchId?: string;
  kind?: string;
}) {
  const q = new URLSearchParams({ allocate: 'true' });
  if (opts?.branchId) q.set('branchId', opts.branchId);
  if (opts?.kind) q.set('kind', opts.kind);
  return apiFetch<{ internalId: string; sequenceNumber: number }>(
    `/settings/invoice-numbering/next?${q}`,
    { tenantScoped: true },
  );
}

export function peekNextInternalId(opts?: {
  branchId?: string;
  kind?: string;
}) {
  const q = new URLSearchParams();
  if (opts?.branchId) q.set('branchId', opts.branchId);
  if (opts?.kind) q.set('kind', opts.kind);
  return apiFetch<{ internalId: string }>(
    `/settings/invoice-numbering/next?${q}`,
    { tenantScoped: true },
  );
}
