import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { tenantLifecycleStatus } from './tenant-lifecycle-status';

export type TenantWriteCheck = { allowed: true } | { allowed: false; reason: string };

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Billing recovery routes stay open even for READ_ONLY / SUSPENDED tenants (past-due self-heal). */
const BILLING_RECOVERY_PATH_PREFIXES = [
  '/billing/checkout',
  '/billing/change-plan',
  '/billing/enterprise-request',
  '/billing/webhooks',
];

const OPEN_WRITE_PATH_PREFIXES = [...BILLING_RECOVERY_PATH_PREFIXES, '/platform-admin'];

@Injectable()
export class TenantAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** Pending / rejected / suspended tenants and READ_ONLY subscriptions block writes. */
  async isWriteAllowed(tenantId: string): Promise<TenantWriteCheck> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { suspendedAt: true, activationStatus: true },
    });
    if (!tenant) {
      return { allowed: false, reason: 'tenant_not_found' };
    }

    const lifecycle = tenantLifecycleStatus(tenant);
    if (lifecycle === 'PENDING') {
      return { allowed: false, reason: 'tenant_pending_approval' };
    }
    if (lifecycle === 'REJECTED') {
      return { allowed: false, reason: 'tenant_rejected' };
    }
    if (lifecycle === 'SUSPENDED' || tenant.suspendedAt) {
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
 * Global write-gate: blocks mutating requests for pending / rejected / READ_ONLY /
 * SUSPENDED tenants everywhere except billing recovery, platform-admin, and
 * tenant create/switch (so a pending user can still log in, switch companies,
 * and an approved owner can create a sub-company).
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

    const path = (req.path || req.url || '').split('?')[0];
    if (OPEN_WRITE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }
    if (method === 'POST' && (path === '/tenants' || path === '/tenants/switch')) {
      return true;
    }

    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return true;
    }

    const result = await this.access.isWriteAllowed(tenantId);
    if (!result.allowed) {
      throw new ForbiddenException(result.reason);
    }
    return true;
  }
}
