import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@einvoice/shared';
import type { AuthUser } from '../auth/current-user.decorator';
import { TenantService } from '../tenant/tenant.service';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...perms: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: AuthUser;
      headers: Record<string, string | undefined>;
    }>();
    if (!req.user) {
      throw new UnauthorizedException();
    }
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      throw new ForbiddenException('X-Tenant-Id required');
    }

    for (const code of required) {
      const ok = await this.tenants.userHasPermission(req.user.userId, tenantId, code);
      if (!ok) {
        throw new ForbiddenException(`Missing permission: ${code}`);
      }
    }
    return true;
  }
}
