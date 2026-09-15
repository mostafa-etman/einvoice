import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type AccountBilling = {
  id: string;
  ownerUserId: string | null;
  pointsBalance: number;
  trialEndsAt: Date | null;
  extraUsers: number;
  extraCompanies: number;
};

const accountBillingSelect = {
  id: true,
  ownerUserId: true,
  pointsBalance: true,
  trialEndsAt: true,
  extraUsers: true,
  extraCompanies: true,
} as const;

export async function requireTenantAccount(
  prisma: PrismaService,
  tenantId: string,
): Promise<{ tenantId: string; accountId: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, accountId: true },
  });
  if (!tenant) throw new NotFoundException('tenant_not_found');
  return { tenantId: tenant.id, accountId: tenant.accountId };
}

export async function loadAccountBilling(
  prisma: PrismaService,
  tenantId: string,
): Promise<{ tenantId: string; account: AccountBilling }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, account: { select: accountBillingSelect } },
  });
  if (!tenant?.account) throw new NotFoundException('tenant_not_found');
  return { tenantId: tenant.id, account: tenant.account };
}

export async function findOwnerAccountId(
  prisma: PrismaService | Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  const owned = await prisma.account.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return owned?.id ?? null;
}
