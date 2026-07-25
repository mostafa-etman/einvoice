import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { RefreshService } from './refresh.service';

export type JwtPayload = { sub: string; email: string };

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
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
    return this.issueSession(user.id, user.email, user.name);
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
    return this.issueSession(user.id, user.email, user.name);
  }

  async refreshSession(rawToken: string) {
    const rotated = await this.refresh.rotate(rawToken, this.env.REFRESH_TTL_DAYS);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: rotated.userId } });
    const accessToken = await this.signAccess(user.id, user.email);
    return {
      accessToken,
      expiresIn: 900,
      refreshRaw: rotated.raw,
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

  private async issueSession(userId: string, email: string, name: string | null) {
    const accessToken = await this.signAccess(userId, email);
    const { raw } = await this.refresh.issue(userId, this.env.REFRESH_TTL_DAYS);
    return {
      accessToken,
      expiresIn: 900,
      refreshRaw: raw,
      user: { id: userId, email, name },
    };
  }

  private signAccess(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwt.signAsync(payload);
  }
}
