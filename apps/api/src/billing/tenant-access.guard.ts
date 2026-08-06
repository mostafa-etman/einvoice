import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type TenantWriteCheck = { allowed: true } | { allowed: false; reason: string };

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Billing recovery routes stay open even for READ_ONLY / SUSPENDED tenants (past-due self-heal). */
const BILLING_RECOVERY_PATH_PREFIXES = [
  '/billing/checkout',
  '/billing/change-plan',
  '/billing/enterprise-request',
  '/billing/webhooks',
];

@Injectable()
export class TenantAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** Suspended tenants and PAST_DUE-after-grace (READ_ONLY) / operator SUSPENDED subscriptions block writes. */
  async isWriteAllowed(tenantId: string): Promise<TenantWriteCheck> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { suspendedAt: true },
    });
    if (tenant?.suspendedAt) {
      return { allowed: false, reason: 'tenant_suspended' };
    }

    const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId }, select: { status: true } }),
    );
    if (subscription?.status === 'READ_ONLY') {
      return { allowed: false, reason: 'tenant_read_only' };
    }
    if (subscription?.status === 'SUSPENDED') {
      return { allowed: false, reason: 'tenant_suspended' };
    }

    return { allowed: true };
  }
}

/**
 * Global write-gate: blocks mutating requests for READ_ONLY / SUSPENDED tenants
 * everywhere except billing recovery routes (checkout, change-plan, enterprise
 * request, webhooks) and GET/HEAD (always allowed — "billing recovery" + read access).
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly access: TenantAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      path?: string;
      url?: string;
      headers: Record<string, string | undefined>;
    }>();

    const method = req.method?.toUpperCase() ?? 'GET';
    if (!WRITE_METHODS.has(method)) {
      return true;
    }

    const path = req.path || req.url || '';
    if (BILLING_RECOVERY_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      // No tenant context yet — let downstream guards/controllers reject with the usual 400.
      return true;
    }

    const result = await this.access.isWriteAllowed(tenantId);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason);
    }
    return true;
  }
}
