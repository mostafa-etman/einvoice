import { apiFetch } from './client';
import { setActiveBranchId, setActiveTenantId } from '@/lib/session';

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

export async function listMyTenants(): Promise<TenantMembership[]> {
  return apiFetch<TenantMembership[]>('/tenants');
}

export async function createTenant(name: string): Promise<{ id: string; name: string }> {
  const tenant = await apiFetch<{ id: string; name: string }>('/tenants', {
    method: 'POST',
    body: { name },
  });
  setActiveTenantId(tenant.id);
  setActiveBranchId(null);
  return tenant;
}

export async function listBranches(): Promise<Branch[]> {
  return apiFetch<Branch[]>('/branches', { tenantScoped: true });
}
