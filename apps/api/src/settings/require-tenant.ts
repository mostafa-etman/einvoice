import { BadRequestException } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';

export function requireTenant(header: string | undefined): string {
  if (!header) {
    throw new BadRequestException('X-Tenant-Id header is required');
  }
  return header;
}

/** Session `tid` after PermissionsGuard bind — never trust a raw client header. */
export function requireSessionTenant(user: AuthUser): string {
  if (!user.tenantId) {
    throw new BadRequestException('Active tenant is required');
  }
  return user.tenantId;
}
