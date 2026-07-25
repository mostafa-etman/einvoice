import { listBranches, listMyTenants } from '@/lib/api/tenants';
import { setActiveBranchId, setActiveTenantId } from '@/lib/session';

/** Select first tenant and its default branch after authentication. */
export async function establishTenantContext(): Promise<{ needsOnboarding: boolean }> {
  const memberships = await listMyTenants();
  if (!memberships.length) {
    return { needsOnboarding: true };
  }

  setActiveTenantId(memberships[0].tenant.id);
  const branches = await listBranches();
  const defaultBranch = branches.find((b) => b.isDefault) ?? branches[0];
  if (defaultBranch) {
    setActiveBranchId(defaultBranch.id);
  }

  return { needsOnboarding: false };
}
