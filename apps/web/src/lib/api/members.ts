import { apiFetch } from './client';

export type Member = {
  id: string;
  user: { id: string; email: string; name: string | null };
  role: { id: string; name: string };
};

export async function listMembers(): Promise<Member[]> {
  return apiFetch<Member[]>('/members', { tenantScoped: true });
}

export async function addMember(email: string, roleId: string): Promise<Member> {
  return apiFetch<Member>('/members', {
    method: 'POST',
    tenantScoped: true,
    body: { email, roleId },
  });
}

export async function updateMemberRole(
  membershipId: string,
  roleId: string,
): Promise<Member> {
  return apiFetch<Member>('/members', {
    method: 'PATCH',
    tenantScoped: true,
    body: { membershipId, roleId },
  });
}
