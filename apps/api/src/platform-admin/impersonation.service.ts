import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ImpersonationSession } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PLATFORM_AUDIT_ACTIONS } from './platform-audit';

/** Signed with JWT_ACCESS_SECRET — CRITICAL: never set isPlatformOperator true. */
export type ImpersonationClaims = {
  sub: string;
  impersonationSessionId: string;
  mode: 'READ_ONLY' | 'WRITE';
  operatorUserId: string;
  isPlatformOperator: false;
};

export type StartImpersonationInput = {
  operatorUserId: string;
  tenantId: string;
  targetUserId: string;
  reason: string;
  ttlMinutes?: number;
};

export type ImpersonationSessionResult = {
  session: ImpersonationSession;
  accessToken: string;
};

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async start(input: StartImpersonationInput): Promise<ImpersonationSessionResult> {
    // `memberships` is FORCE RLS — a plain (unscoped) lookup always returns
    // zero rows, so this must run inside the tenant's RLS context.
    const membership = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.membership.findFirst({
        where: { tenantId: input.tenantId, userId: input.targetUserId },
      }),
    );
    if (!membership) {
      throw new BadRequestException('target_user_not_member_of_tenant');
    }

    const env = loadEnv();
    const ttlMinutes = input.ttlMinutes ?? env.IMPERSONATION_TTL_MINUTES;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    const session = await this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.create({
        data: {
          operatorUserId: input.operatorUserId,
          targetUserId: input.targetUserId,
          tenantId: input.tenantId,
          reason: input.reason,
          mode: 'READ_ONLY',
          expiresAt,
        },
      }),
    );

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_START,
      outcome: 'success',
      actorUserId: input.operatorUserId,
      tenantId: input.tenantId,
      resourceType: 'impersonation_session',
      resourceId: session.id,
      metadata: { targetUserId: input.targetUserId, reason: input.reason, mode: 'READ_ONLY' },
    });

    return { session, accessToken: await this.signToken(session) };
  }

  async breakGlass(
    sessionId: string,
    operatorUserId: string,
    reason: string,
  ): Promise<ImpersonationSessionResult> {
    const session = await this.validateSession(sessionId);
    if (session.operatorUserId !== operatorUserId) {
      throw new ForbiddenException('not_session_owner');
    }

    const updated = await this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.update({
        where: { id: sessionId },
        data: { mode: 'WRITE', breakGlassReason: reason },
      }),
    );

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_BREAK_GLASS,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId: session.tenantId,
      resourceType: 'impersonation_session',
      resourceId: sessionId,
      metadata: { reason },
    });

    return { session: updated, accessToken: await this.signToken(updated) };
  }

  async end(sessionId: string, operatorUserId: string): Promise<{ ok: true }> {
    const session = await this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.findUnique({ where: { id: sessionId } }),
    );
    if (!session) {
      throw new NotFoundException('impersonation_session_not_found');
    }
    if (!session.endedAt) {
      await this.tenantPrisma.withPlatformOperator((tx) =>
        tx.impersonationSession.update({
          where: { id: sessionId },
          data: { endedAt: new Date() },
        }),
      );
    }
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_END,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId: session.tenantId,
      resourceType: 'impersonation_session',
      resourceId: sessionId,
    });
    return { ok: true };
  }

  /** Read-only lookup (no enforcement) — used for best-effort context on denial audits. */
  getById(sessionId: string): Promise<ImpersonationSession | null> {
    return this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.findUnique({ where: { id: sessionId } }),
    );
  }

  /** Throws (with an expiry audit row) when the session is ended or past its TTL. */
  async validateSession(sessionId: string): Promise<ImpersonationSession> {
    const session = await this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.findUnique({ where: { id: sessionId } }),
    );
    if (!session) {
      throw new ForbiddenException('impersonation_session_not_found');
    }
    if (session.endedAt) {
      throw new ForbiddenException('impersonation_session_ended');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.expire(session);
      throw new ForbiddenException('impersonation_session_expired');
    }
    return session;
  }

  /** Sweeper for sessions past TTL that were never explicitly ended (T077). */
  async expireStaleSessions(now: Date = new Date()): Promise<number> {
    const stale = await this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.findMany({
        where: { endedAt: null, expiresAt: { lte: now } },
      }),
    );
    for (const session of stale) {
      await this.expire(session);
    }
    return stale.length;
  }

  private async expire(session: ImpersonationSession): Promise<void> {
    await this.tenantPrisma.withPlatformOperator((tx) =>
      tx.impersonationSession.update({
        where: { id: session.id },
        data: { endedAt: new Date() },
      }),
    );
    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_EXPIRE,
      outcome: 'success',
      actorUserId: session.operatorUserId,
      tenantId: session.tenantId,
      resourceType: 'impersonation_session',
      resourceId: session.id,
    });
  }

  private signToken(session: ImpersonationSession): Promise<string> {
    const remainingMs = session.expiresAt.getTime() - Date.now();
    const expiresIn = Math.max(30, Math.floor(remainingMs / 1000));
    const payload: ImpersonationClaims = {
      sub: session.targetUserId,
      impersonationSessionId: session.id,
      mode: session.mode,
      operatorUserId: session.operatorUserId,
      isPlatformOperator: false,
    };
    return this.jwt.signAsync(payload, { expiresIn });
  }
}
