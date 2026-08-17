import { apiFetch } from './client';
import type { AddressInput } from './documents';

export type Customer = {
  id: string;
  type: string;
  registrationId: string;
  name: string;
  nameEn: string | null;
  address: AddressInput;
  code: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  receiver: {
    type: string;
    id: string;
    name: string;
    address: AddressInput;
  };
};

export type CustomerWrite = {
  type: string;
  registrationId: string;
  name: string;
  nameEn?: string | null;
  address: AddressInput;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
};

export type CustomerListResult = {
  items: Customer[];
  nextCursor: string | null;
};

export async function listCustomers(params: {
  q?: string;
  type?: string;
  active?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
} = {}): Promise<CustomerListResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.type) qs.set('type', params.type);
  if (params.active !== undefined) qs.set('active', String(params.active));
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.sortDir) qs.set('sortDir', params.sortDir);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiFetch<CustomerListResult>(`/customers${suffix}`, { tenantScoped: true });
}

export async function searchCustomers(
  q: string,
  limit = 20,
): Promise<{ items: Customer[] }> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<{ items: Customer[] }>(`/customers/search?${qs}`, {
    tenantScoped: true,
  });
}

export async function getCustomer(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}`, { tenantScoped: true });
}

export async function createCustomer(body: CustomerWrite): Promise<Customer> {
  return apiFetch<Customer>('/customers', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export async function updateCustomer(
  id: string,
  body: CustomerWrite,
): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body,
  });
}

export async function deactivateCustomer(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}/deactivate`, {
    method: 'POST',
    tenantScoped: true,
  });
}
