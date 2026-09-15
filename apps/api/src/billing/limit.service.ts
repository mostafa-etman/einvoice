import { Injectable } from '@nestjs/common';
import type { Plan, QuotaOverride } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LimitExceededError, LimitExceededHttpException } from './limit-errors';
import { PointsService } from './points.service';
import { loadAccountBilling, requireTenantAccount } from './account-scope';

export type LimitSnapshot = {
  maxUsers: number;
  maxCompanies: number;
  extraUsers: number;
  extraCompanies: number;
  users: { used: number; limit: number };
  companies: { used: number; limit: number };
  overrideActive: boolean;
};

type LimitPlan = Pick<Plan, 'maxUsers' | 'maxCompanies'>;
type LimitOverride = Pick<QuotaOverride, 'userQuota' | 'companyQuota' | 'expiresAt'> | null;

export function mergeUserCompanyLimits(
  plan: LimitPlan,
  extraUsers: number,
  extraCompanies: number,
  override: LimitOverride,
  now: Date = new Date(),
): { maxUsers: number; maxCompanies: number; overrideActive: boolean } {
  const active = Boolean(override) && (!override!.expiresAt || override!.expiresAt.getTime() > now.getTime());
  const fromPlanUsers = Math.max(0, plan.maxUsers) + Math.max(0, extraUsers);
  const fromPlanCompanies = Math.max(0, plan.maxCompanies) + Math.max(0, extraCompanies);
  return {
    maxUsers: active && override!.userQuota != null ? override!.userQuota : fromPlanUsers,
    maxCompanies: active && override!.companyQuota != null ? override!.companyQuota : fromPlanCompanies,
    overrideActive: active,
  };
}

@Injectable()
export class LimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly points: PointsService,
  ) {}

  async snapshot(tenantId: string): Promise<LimitSnapshot> {
    const { account } = await loadAccountBilling(this.prisma, tenantId);
    const { accountId } = await requireTenantAccount(this.prisma, tenantId);

    const [subscription, override, userCount, companyUsed] = await Promise.all([
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.subscription.findUnique({ where: { accountId }, include: { plan: true } }),
      ),
      this.accountUserCompanyOverride(accountId),
      this.countAccountUsers(accountId),
      this.prisma.tenant.count({ where: { accountId } }),
    ]);

    const plan = subscription?.plan ?? (await this.prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } }));
    const merged = mergeUserCompanyLimits(plan, account.extraUsers, account.extraCompanies, override);

    return {
      maxUsers: merged.maxUsers,
      maxCompanies: merged.maxCompanies,
      extraUsers: account.extraUsers,
      extraCompanies: account.extraCompanies,
      users: { used: userCount, limit: merged.maxUsers },
      companies: { used: companyUsed, limit: merged.maxCompanies },
      overrideActive: merged.overrideActive,
    };
  }

  async assertCanAddMember(tenantId: string, userId?: string): Promise<void> {
    const { accountId } = await requireTenantAccount(this.prisma, tenantId);
    if (userId && (await this.userInAccount(accountId, userId))) return;
    const snap = await this.snapshot(tenantId);
    if (snap.users.used >= snap.users.limit) {
      throw await this.limitException('users', snap.users.used, snap.users.limit);
    }
  }

  /** Blocks creating another company beyond the account cap. First company is always allowed. */
  async assertCanCreateCompany(userId: string): Promise<void> {
    const accountId = await this.ownerAccountId(userId);
    if (!accountId) return;
    const used = await this.prisma.tenant.count({ where: { accountId } });
    if (used <= 0) return;
    const anyTenant = await this.prisma.tenant.findFirst({
      where: { accountId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!anyTenant) return;
    const snap = await this.snapshot(anyTenant.id);
    if (used >= snap.maxCompanies) {
      throw await this.limitException('companies', used, snap.maxCompanies);
    }
  }

  private async ownerAccountId(userId: string): Promise<string | null> {
    const owned = await this.prisma.account.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (owned) return owned.id;
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, role: { name: 'Owner' } },
        select: { tenantId: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    if (!memberships.length) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: memberships[0].tenantId },
      select: { accountId: true },
    });
    return tenant?.accountId ?? null;
  }

  private async countAccountUsers(accountId: string): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      where: { accountId },
      select: { id: true },
    });
    const userIds = new Set<string>();
    for (const tenant of tenants) {
      const members = await this.tenantPrisma.withTenant(tenant.id, (tx) =>
        tx.membership.findMany({ where: { tenantId: tenant.id }, select: { userId: true } }),
      );
      for (const m of members) userIds.add(m.userId);
    }
    return userIds.size;
  }

  private async userInAccount(accountId: string, userId: string): Promise<boolean> {
    const tenants = await this.prisma.tenant.findMany({
      where: { accountId },
      select: { id: true },
    });
    for (const tenant of tenants) {
      const membership = await this.tenantPrisma.withTenant(tenant.id, (tx) =>
        tx.membership.findFirst({
          where: { tenantId: tenant.id, userId },
          select: { id: true },
        }),
      );
      if (membership) return true;
    }
    return false;
  }

  private async accountUserCompanyOverride(accountId: string): Promise<LimitOverride> {
    const tenants = await this.prisma.tenant.findMany({
      where: { accountId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    let latest: LimitOverride = null;
    let latestAt = 0;
    for (const tenant of tenants) {
      const override = await this.tenantPrisma.withTenant(tenant.id, (tx) =>
        tx.quotaOverride.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' },
        }),
      );
      if (!override) continue;
      if (override.userQuota == null && override.companyQuota == null) continue;
      const at = override.createdAt.getTime();
      if (at >= latestAt) {
        latestAt = at;
        latest = override;
      }
    }
    return latest;
  }

  private async limitException(resource: 'users' | 'companies', used: number, limit: number) {
    const contact = await this.points.getSupportContact();
    return new LimitExceededHttpException(
      new LimitExceededError(resource, used, limit, contact.whatsappUrl, contact.whatsappDisplay),
    );
  }
}
