import { establishTenantContext } from '@/lib/establish-tenant-context';

jest.mock('@/lib/api/tenants', () => ({
  listMyTenants: jest.fn(),
  listBranches: jest.fn(),
  switchTenant: jest.fn(),
}));

jest.mock('@/lib/api/eta-credentials', () => ({
  getEtaSetupStatus: jest.fn(),
}));

import { listBranches, listMyTenants, switchTenant } from '@/lib/api/tenants';
import { getEtaSetupStatus } from '@/lib/api/eta-credentials';
import { getActiveBranchId, getActiveTenantId, setActiveTenantId } from '@/lib/session';

const listMyTenantsMock = listMyTenants as jest.Mock;
const listBranchesMock = listBranches as jest.Mock;
const switchTenantMock = switchTenant as jest.Mock;
const getEtaSetupStatusMock = getEtaSetupStatus as jest.Mock;

describe('establishTenantContext', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('selects first tenant and default branch', async () => {
    listMyTenantsMock.mockResolvedValue([
      {
        tenant: { id: 'tenant-1', name: 'esafe' },
        role: { id: 'role-1', name: 'Owner' },
      },
    ]);
    listBranchesMock.mockResolvedValue([
      { id: 'branch-main', name: 'Main', isDefault: true },
    ]);
    switchTenantMock.mockImplementation(async (id: string) => {
      setActiveTenantId(id);
      return { accessToken: 'tok', activeTenantId: id, tenant: { id, name: 'esafe' }, role: null };
    });
    getEtaSetupStatusMock.mockResolvedValue({
      etaConfigured: false,
      promptDismissed: true,
      promptEtaSetup: false,
      tutorialVideoUrl: null,
    });

    const result = await establishTenantContext();

    expect(result.needsOnboarding).toBe(false);
    expect(result.promptEtaSetup).toBe(false);
    expect(switchTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(getActiveTenantId()).toBe('tenant-1');
    expect(getActiveBranchId()).toBe('branch-main');
  });

  it('returns needsOnboarding when user has no tenants', async () => {
    listMyTenantsMock.mockResolvedValue([]);

    const result = await establishTenantContext();

    expect(result.needsOnboarding).toBe(true);
    expect(result.promptEtaSetup).toBe(false);
    expect(getActiveTenantId()).toBeNull();
  });

  it('prompts ETA setup when the tenant has not connected and has not dismissed', async () => {
    listMyTenantsMock.mockResolvedValue([
      {
        tenant: { id: 'tenant-1', name: 'esafe', lifecycleStatus: 'ACTIVE' },
        role: { id: 'role-1', name: 'Owner' },
      },
    ]);
    listBranchesMock.mockResolvedValue([
      { id: 'branch-main', name: 'Main', isDefault: true },
    ]);
    switchTenantMock.mockImplementation(async (id: string) => {
      setActiveTenantId(id);
      return { accessToken: 'tok', activeTenantId: id, tenant: { id, name: 'esafe' }, role: null };
    });
    getEtaSetupStatusMock.mockResolvedValue({
      etaConfigured: false,
      promptDismissed: false,
      promptEtaSetup: true,
      tutorialVideoUrl: null,
    });

    const result = await establishTenantContext();
    expect(result.promptEtaSetup).toBe(true);
  });
});
