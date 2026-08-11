import { apiFetch } from './client';
import { setAccessToken, setActiveBranchId, setActiveTenantId } from '@/lib/session';

export type TenantMembership = {
  tenant: { id: string; name: string };
  role: { id: string; name: string };
};

export type Branch = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive?: boolean;
};

export type SwitchTenantResult = {
  accessToken: string;
  activeTenantId: string;
  tenant: { id: string; name: string };
  role: { id: string; name: string } | null;
};

export async function listMyTenants(): Promise<TenantMembership[]> {
  return apiFetch<TenantMembership[]>('/tenants');
}

/** Re-bind the server session to a company the user belongs to. */
export async function switchTenant(tenantId: string): Promise<SwitchTenantResult> {
  const result = await apiFetch<SwitchTenantResult>('/tenants/switch', {
    method: 'POST',
    body: { tenantId },
  });
  setAccessToken(result.accessToken);
  setActiveTenantId(result.activeTenantId);
  setActiveBranchId(null);
  return result;
}

export async function createTenant(name: string): Promise<{ id: string; name: string }> {
  const tenant = await apiFetch<{
    id: string;
    name: string;
    accessToken?: string;
    activeTenantId?: string;
  }>('/tenants', {
    method: 'POST',
    body: { name },
  });
  if (tenant.accessToken) {
    setAccessToken(tenant.accessToken);
  }
  setActiveTenantId(tenant.activeTenantId ?? tenant.id);
  setActiveBranchId(null);
  return tenant;
}

export async function listBranches(): Promise<Branch[]> {
  return apiFetch<Branch[]>('/branches', { tenantScoped: true });
}
