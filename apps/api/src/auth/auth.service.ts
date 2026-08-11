import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PasswordService } from './password.service';
import { RefreshService } from './refresh.service';

export type JwtPayload = { sub: string; email: string; tid?: string };

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly passwords: PasswordService,
    private readonly refresh: RefreshService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(email: string, password: string, name?: string) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      throw new ConflictException('Unable to register with that email');
    }
    const passwordHash = await this.passwords.hash(password);
    const user = await this.prisma.user.create({
      data: { email: normalized, passwordHash, name },
    });
    await this.audit.write({
      action: 'auth.register.success',
      outcome: 'success',
      actorUserId: user.id,
    });
    return this.issueSession(user.id, user.email, user.name, null);
  }

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user || !(await this.passwords.verify(user.passwordHash, password))) {
      await this.audit.write({
        action: 'auth.login.failure',
        outcome: 'failure',
        metadata: { email: normalized },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.audit.write({
      action: 'auth.login.success',
      outcome: 'success',
      actorUserId: user.id,
    });
    const tenantId = await this.firstMembershipTenantId(user.id);
    return this.issueSession(user.id, user.email, user.name, tenantId);
  }

  async refreshSession(rawToken: string) {
    const rotated = await this.refresh.rotate(rawToken, this.env.REFRESH_TTL_DAYS);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: rotated.userId } });
    let tenantId = rotated.activeTenantId;
    if (tenantId && !(await this.isMember(user.id, tenantId))) {
      tenantId = null;
    }
    if (!tenantId) {
      tenantId = await this.firstMembershipTenantId(user.id);
      if (tenantId) {
        await this.refresh.setActiveTenant(rotated.raw, tenantId);
      }
    }
    const accessToken = await this.signAccess(user.id, user.email, tenantId);
    return {
      accessToken,
      expiresIn: 900,
      refreshRaw: rotated.raw,
      activeTenantId: tenantId,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  async logout(rawToken: string | undefined, userId?: string) {
    if (rawToken) {
      await this.refresh.revoke(rawToken);
    }
    await this.audit.write({
      action: 'auth.logout.success',
      outcome: 'success',
      actorUserId: userId,
    });
  }

  /**
   * Bind this login session to a tenant the user actually belongs to.
   * Re-issues the access token with `tid` so RLS context is not taken from the client.
   */
  async switchTenant(userId: string, tenantId: string, refreshRaw?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.isMember(userId, tenantId))) {
      throw new ForbiddenException('Not a member of this tenant');
    }
    if (refreshRaw) {
      await this.refresh.setActiveTenant(refreshRaw, tenantId);
    }
    await this.audit.write({
      action: 'tenant.switch.success',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
    });
    const accessToken = await this.signAccess(userId, user.email, tenantId);
    return {
      accessToken,
      expiresIn: 900,
      activeTenantId: tenantId,
    };
  }

  private async issueSession(
    userId: string,
    email: string,
    name: string | null,
    tenantId: string | null,
  ) {
    const accessToken = await this.signAccess(userId, email, tenantId);
    const { raw } = await this.refresh.issue(userId, this.env.REFRESH_TTL_DAYS, tenantId);
    return {
      accessToken,
      expiresIn: 900,
      refreshRaw: raw,
      activeTenantId: tenantId,
      user: { id: userId, email, name },
    };
  }

  private signAccess(userId: string, email: string, tenantId: string | null) {
    const payload: JwtPayload = tenantId
      ? { sub: userId, email, tid: tenantId }
      : { sub: userId, email };
    return this.jwt.signAsync(payload);
  }

  private async firstMembershipTenantId(userId: string): Promise<string | null> {
    const rows = await this.tenantPrisma.withUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { tenantId: true },
        take: 1,
      }),
    );
    return rows[0]?.tenantId ?? null;
  }

  private async isMember(userId: string, tenantId: string): Promise<boolean> {
    try {
      const membership = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId } },
          select: { id: true },
        }),
      );
      return Boolean(membership);
    } catch {
      return false;
    }
  }
}
