import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Run fn inside a transaction with SET LOCAL app.tenant_id (DB-layer RLS). */
  async withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      throw new Error('Invalid tenant id');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`;
      return fn(tx);
    });
  }

  /** Own-membership lookups when no active tenant (list my tenants). */
  async withUser<T>(userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(userId)) {
      throw new Error('Invalid user id');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Platform-operator path for tables that allow `app.platform_operator=1`
   * (e.g. impersonation_sessions sweeps). Never call from tenant HTTP handlers.
   */
  async withPlatformOperator<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`;
      await tx.$executeRaw`SELECT set_config('app.platform_operator', '1', true)`;
      return fn(tx);
    });
  }

  get client(): PrismaService {
    return this.prisma;
  }
}
