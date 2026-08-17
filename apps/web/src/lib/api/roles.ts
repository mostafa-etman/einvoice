import { apiFetch } from './client';

export type Role = {
  id: string;
  name: string;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
};

export type PermissionCatalog = {
  canManage: boolean;
  codes: string[];
  groups: Array<{ id: string; codes: string[] }>;
};

export async function listRoles(): Promise<Role[]> {
  return apiFetch<Role[]>('/roles', { tenantScoped: true });
}

export async function getPermissionCatalog(): Promise<PermissionCatalog> {
  return apiFetch<PermissionCatalog>('/permissions', { tenantScoped: true });
}

export async function createRole(input: {
  name: string;
  permissions: string[];
}): Promise<Role> {
  return apiFetch<Role>('/roles', {
    method: 'POST',
    tenantScoped: true,
    body: input,
  });
}

export async function updateRole(
  id: string,
  input: { name?: string; permissions?: string[] },
): Promise<Role> {
  return apiFetch<Role>(`/roles/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body: input,
  });
}

export async function deleteRole(id: string, reassignToRoleId?: string): Promise<void> {
  const q = reassignToRoleId
    ? `?reassignToRoleId=${encodeURIComponent(reassignToRoleId)}`
    : '';
  await apiFetch<void>(`/roles/${id}${q}`, {
    method: 'DELETE',
    tenantScoped: true,
  });
}
