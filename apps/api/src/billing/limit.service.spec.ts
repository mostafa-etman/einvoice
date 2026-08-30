import { mergeUserCompanyLimits } from './limit.service';

describe('mergeUserCompanyLimits', () => {
  const plan = { maxUsers: 3, maxCompanies: 10 };

  it('adds extra seats from add-ons onto the plan', () => {
    const result = mergeUserCompanyLimits(plan, 2, 1, null);
    expect(result.maxUsers).toBe(5);
    expect(result.maxCompanies).toBe(11);
    expect(result.overrideActive).toBe(false);
  });

  it('lets an admin override replace the effective cap', () => {
    const result = mergeUserCompanyLimits(plan, 2, 1, {
      userQuota: 7,
      companyQuota: 20,
      expiresAt: null,
    });
    expect(result.maxUsers).toBe(7);
    expect(result.maxCompanies).toBe(20);
    expect(result.overrideActive).toBe(true);
  });
});
