import { apiFetch } from './client';

export type Role = {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
};

export async function listRoles(): Promise<Role[]> {
  return apiFetch<Role[]>('/roles', { tenantScoped: true });
}
