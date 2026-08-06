import { apiFetch } from './client';
import type { IssuerAddress } from '@einvoice/eta-core';

export type BranchAddress = IssuerAddress;

export type Branch = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  etaBranchCode: string | null;
  activityCode: string | null;
  defaultCurrencyCode: string | null;
  /** Issuer (seller) address inherited by every document from this branch. */
  address: BranchAddress;
  addressComplete: boolean;
};

export async function listBranches(): Promise<Branch[]> {
  return apiFetch<Branch[]>('/branches', { tenantScoped: true });
}

export async function createBranch(body: {
  name: string;
  isDefault?: boolean;
  etaBranchCode?: string;
  activityCode?: string;
  defaultCurrencyCode?: string;
  address?: BranchAddress;
}): Promise<Branch> {
  return apiFetch<Branch>('/branches', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export async function updateBranch(
  id: string,
  body: Partial<{
    name: string;
    isDefault: boolean;
    isActive: boolean;
    etaBranchCode: string | null;
    activityCode: string | null;
    defaultCurrencyCode: string | null;
    address: BranchAddress;
  }>,
): Promise<Branch> {
  return apiFetch<Branch>(`/branches/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body,
  });
}
