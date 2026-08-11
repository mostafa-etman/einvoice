import { listBranches, listMyTenants, switchTenant } from '@/lib/api/tenants';
import { getActiveTenantId, setActiveBranchId } from '@/lib/session';

/** Select tenant (prefer last local choice if still a member) and bind it server-side. */
export async function establishTenantContext(): Promise<{ needsOnboarding: boolean }> {
  const memberships = await listMyTenants();
  if (!memberships.length) {
    return { needsOnboarding: true };
  }

  const stored = getActiveTenantId();
  const next =
    stored && memberships.some((m) => m.tenant.id === stored)
      ? stored
      : memberships[0].tenant.id;
  await switchTenant(next);

  const branches = await listBranches();
  const defaultBranch = branches.find((b) => b.isDefault) ?? branches[0];
  if (defaultBranch) {
    setActiveBranchId(defaultBranch.id);
  }

  return { needsOnboarding: false };
}
