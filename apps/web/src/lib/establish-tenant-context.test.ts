import { establishTenantContext } from '@/lib/establish-tenant-context';

jest.mock('@/lib/api/tenants', () => ({
  listMyTenants: jest.fn(),
  listBranches: jest.fn(),
  switchTenant: jest.fn(),
}));

import { listBranches, listMyTenants, switchTenant } from '@/lib/api/tenants';
import { getActiveBranchId, getActiveTenantId, setActiveTenantId } from '@/lib/session';

const listMyTenantsMock = listMyTenants as jest.Mock;
const listBranchesMock = listBranches as jest.Mock;
const switchTenantMock = switchTenant as jest.Mock;

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

    const result = await establishTenantContext();

    expect(result.needsOnboarding).toBe(false);
    expect(switchTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(getActiveTenantId()).toBe('tenant-1');
    expect(getActiveBranchId()).toBe('branch-main');
  });

  it('returns needsOnboarding when user has no tenants', async () => {
    listMyTenantsMock.mockResolvedValue([]);

    const result = await establishTenantContext();

    expect(result.needsOnboarding).toBe(true);
    expect(getActiveTenantId()).toBeNull();
  });
});
