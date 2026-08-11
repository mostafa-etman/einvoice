import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { TenantService } from './tenant.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantAwareRequest = {
  user?: AuthUser;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Resolves the active company from the access-token `tid` claim (session),
 * falling back to `X-Tenant-Id` only when the token has no tid (legacy tests
 * and pre-switch tokens). The client cannot override a bound session tenant,
 * and cannot select a tenant they are not a member of.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly tenants: TenantService) {}

  async bind(req: TenantAwareRequest): Promise<string | null> {
    if (!req.user) {
      return null;
    }

    const jwtTid = req.user.tenantId;
    const headerTid = headerValue(req.headers['x-tenant-id']);

    if (jwtTid && headerTid && jwtTid !== headerTid) {
      throw new ForbiddenException('Tenant does not match session');
    }

    const tenantId = jwtTid ?? headerTid;
    if (!tenantId) {
      return null;
    }
    if (!UUID_RE.test(tenantId)) {
      throw new ForbiddenException('Invalid tenant id');
    }

    const membership = await this.tenants.getMembership(req.user.userId, tenantId);
    if (!membership) {
      // An explicit client header is a claim — always reject.
      // A stale JWT `tid` with no header must not block GET /tenants or switch.
      if (headerTid) {
        throw new ForbiddenException('Not a member of this tenant');
      }
      return null;
    }

    req.user.tenantId = tenantId;
    req.headers['x-tenant-id'] = tenantId;
    return tenantId;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
