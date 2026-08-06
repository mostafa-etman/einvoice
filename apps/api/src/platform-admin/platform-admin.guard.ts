import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Platform-operator gate — separate from tenant RBAC (research.md R5).
 * CRITICAL: impersonation-scoped credentials must NEVER satisfy this guard,
 * even if the impersonated target user happens to also be a platform operator.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      throw new UnauthorizedException();
    }
    if (req.user.impersonation) {
      throw new ForbiddenException('impersonation_credentials_cannot_access_platform_admin');
    }
    const user = await this.prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user?.isPlatformOperator) {
      throw new ForbiddenException('platform_operator_required');
    }
    return true;
  }
}
