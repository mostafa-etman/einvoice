import {
  getActiveBranchId,
  getActiveTenantId,
  setActiveBranchId,
  setActiveTenantId,
} from '@/lib/session';

describe('tenant/branch switcher persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists active tenant and branch ids', () => {
    setActiveTenantId('11111111-1111-4111-8111-111111111111');
    setActiveBranchId('22222222-2222-4222-8222-222222222222');
    expect(getActiveTenantId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(getActiveBranchId()).toBe('22222222-2222-4222-8222-222222222222');
  });
});
