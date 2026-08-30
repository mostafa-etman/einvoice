import { Injectable, NotFoundException } from '@nestjs/common';
import type { Plan, QuotaOverride } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LimitExceededError, LimitExceededHttpException } from './limit-errors';
import { PointsService } from './points.service';

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
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { extraUsers: true, extraCompanies: true },
    });
    if (!tenant) throw new NotFoundException('tenant_not_found');

    const [subscription, override, userCount, ownerId] = await Promise.all([
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
      ),
      this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.quotaOverride.findFirst({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      this.tenantPrisma.withTenant(tenantId, (tx) => tx.membership.count({ where: { tenantId } })),
      this.ownerUserId(tenantId),
    ]);

    const plan = subscription?.plan ?? (await this.prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } }));
    const merged = mergeUserCompanyLimits(plan, tenant.extraUsers, tenant.extraCompanies, override);
    const companyUsed = ownerId ? await this.countOwnerCompanies(ownerId) : 1;

    return {
      maxUsers: merged.maxUsers,
      maxCompanies: merged.maxCompanies,
      extraUsers: tenant.extraUsers,
      extraCompanies: tenant.extraCompanies,
      users: { used: userCount, limit: merged.maxUsers },
      companies: { used: companyUsed, limit: merged.maxCompanies },
      overrideActive: merged.overrideActive,
    };
  }

  async assertCanAddMember(tenantId: string): Promise<void> {
    const snap = await this.snapshot(tenantId);
    if (snap.users.used >= snap.users.limit) {
      throw await this.limitException('users', snap.users.used, snap.users.limit);
    }
  }

  /** Blocks creating another Owner company beyond the account cap. First company is always allowed. */
  async assertCanCreateCompany(userId: string): Promise<void> {
    const used = await this.countOwnerCompanies(userId);
    if (used <= 0) return;
    const limit = await this.accountCompanyLimit(userId);
    if (used >= limit) {
      throw await this.limitException('companies', used, limit);
    }
  }

  private async accountCompanyLimit(userId: string): Promise<number> {
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, role: { name: 'Owner' } },
        select: { tenantId: true },
      }),
    );
    if (!memberships.length) return 1;
    let max = 1;
    for (const m of memberships) {
      const snap = await this.snapshot(m.tenantId);
      if (snap.maxCompanies > max) max = snap.maxCompanies;
    }
    return max;
  }

  private async countOwnerCompanies(userId: string): Promise<number> {
    const memberships = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, role: { name: 'Owner' } },
        select: { tenantId: true },
      }),
    );
    return memberships.length;
  }

  private async ownerUserId(tenantId: string): Promise<string | null> {
    const membership = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.membership.findFirst({
        where: { tenantId, role: { name: 'Owner' } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      }),
    );
    return membership?.userId ?? null;
  }

  private async limitException(resource: 'users' | 'companies', used: number, limit: number) {
    const contact = await this.points.getSupportContact();
    return new LimitExceededHttpException(
      new LimitExceededError(resource, used, limit, contact.whatsappUrl, contact.whatsappDisplay),
    );
  }
}
