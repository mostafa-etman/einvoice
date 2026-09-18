import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isTenantAdminRole } from '@einvoice/shared';
import type { AuthUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TenantService } from '../tenant/tenant.service';

/**
 * Owner or Admin of the session tenant. Distinct from platform-operator.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  constructor(
    private readonly tenants: TenantService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthUser;
      headers: Record<string, string | string[] | undefined>;
    }>();
    if (!req.user) {
      throw new UnauthorizedException();
    }
    const tenantId = await this.tenantContext.bind(req);
    if (!tenantId) {
      throw new ForbiddenException('X-Tenant-Id required');
    }
    const membership = await this.tenants.getMembership(req.user.userId, tenantId);
    if (!membership || !isTenantAdminRole(membership.role)) {
      throw new ForbiddenException('tenant_admin_required');
    }
    return true;
  }
}
