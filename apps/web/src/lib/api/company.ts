import { apiBase, apiFetch, ApiError } from './client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export type CompanyProfile = {
  workspaceName: string;
  legalName: string | null;
  issuerType: string;
  logo: {
    contentType: string | null;
    byteSize: number | null;
    updatedAt: string | null;
  } | null;
  defaultBranchAddress: {
    branchId: string;
    branchName: string;
    etaBranchCode: string | null;
    activityCode: string | null;
    country: string | null;
    governate: string | null;
    regionCity: string | null;
    street: string | null;
    buildingNumber: string | null;
    postalCode: string | null;
    floor: string | null;
    room: string | null;
    landmark: string | null;
    additionalInformation: string | null;
  } | null;
};

export function getCompanyProfile() {
  return apiFetch<CompanyProfile>('/settings/company', { tenantScoped: true });
}

export async function uploadCompanyLogo(file: File) {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${apiBase()}/settings/company/logo`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
    body: form,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    throw new ApiError(
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: unknown }).message)
        : res.statusText,
      res.status,
      data,
    );
  }
  return data as CompanyProfile;
}

export async function removeCompanyLogo() {
  return apiFetch<CompanyProfile>('/settings/company/logo', {
    method: 'DELETE',
    tenantScoped: true,
  });
}

/** Authenticated blob URL for the settings logo preview `<img>`. */
export async function fetchCompanyLogoObjectUrl(): Promise<string | null> {
  const token = getAccessToken();
  const tenantId = getActiveTenantId();
  const res = await fetch(`${apiBase()}/settings/company/logo`, {
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError('Failed to load logo', res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
