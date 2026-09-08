import { listBranches, listMyTenants, switchTenant } from '@/lib/api/tenants';
import { getEtaSetupStatus } from '@/lib/api/eta-credentials';
import { getActiveTenantId, setActiveBranchId } from '@/lib/session';

export type TenantContextResult = {
  needsOnboarding: boolean;
  promptEtaSetup: boolean;
};

/** Select tenant (prefer last local choice if still a member) and bind it server-side. */
export async function establishTenantContext(): Promise<TenantContextResult> {
  const memberships = await listMyTenants();
  if (!memberships.length) {
    return { needsOnboarding: true, promptEtaSetup: false };
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

  const life = memberships.find((m) => m.tenant.id === next)?.tenant.lifecycleStatus;
  if (life === 'PENDING' || life === 'REJECTED' || life === 'SUSPENDED') {
    return { needsOnboarding: false, promptEtaSetup: false };
  }

  try {
    const setup = await getEtaSetupStatus();
    return { needsOnboarding: false, promptEtaSetup: setup.promptEtaSetup };
  } catch {
    return { needsOnboarding: false, promptEtaSetup: false };
  }
}
