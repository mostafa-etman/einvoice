import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { ImpersonationSession } from '@prisma/client';
import { catchError, from, mergeMap, Observable, tap, throwError } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, ImpersonationClaim } from '../auth/current-user.decorator';
import { ImpersonationService } from './impersonation.service';
import { PLATFORM_AUDIT_ACTIONS } from './platform-audit';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global request guard for impersonation-scoped tokens (T076):
 * - READ_ONLY sessions may only GET/HEAD; any write is refused.
 * - Expired / ended sessions are denied (with an audit row).
 * - Every tenant API request under an active session — read AND write — writes
 *   its own `platform.impersonation.action` audit row. No sampling.
 *
 * Registered as a global NestInterceptor (not a CanActivate) so it runs AFTER
 * JwtAuthGuard has already populated `req.user` from the bearer token.
 */
@Injectable()
export class ImpersonationGuard implements NestInterceptor {
  constructor(
    private readonly impersonation: ImpersonationService,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      path?: string;
      url?: string;
      user?: AuthUser;
    }>();

    const claim = req.user?.impersonation;
    if (!claim) {
      return next.handle();
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const path = req.path || req.url || '';
    const isWrite = WRITE_METHODS.has(method);

    return from(this.impersonation.validateSession(claim.sessionId)).pipe(
      mergeMap((session) => {
        if (isWrite && session.mode !== 'WRITE') {
          return throwError(() => new ForbiddenException('impersonation_read_only'));
        }
        return next.handle().pipe(
          tap({
            next: () => this.record(session, method, path, 'success'),
            error: () => this.record(session, method, path, 'failure'),
          }),
        );
      }),
      catchError((err: unknown) => {
        // Denied before (or instead of) reaching the handler — still audit the attempt.
        void this.recordDenied(claim, method, path);
        return throwError(() => err);
      }),
    );
  }

  private record(
    session: ImpersonationSession,
    method: string,
    path: string,
    outcome: 'success' | 'failure',
  ): void {
    void this.audit
      .write({
        action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_ACTION,
        outcome,
        actorUserId: session.operatorUserId,
        tenantId: session.tenantId,
        resourceType: 'impersonation_session',
        resourceId: session.id,
        metadata: {
          targetUserId: session.targetUserId,
          mode: session.mode,
          method,
          path,
        },
      })
      .catch(() => undefined);
  }

  private async recordDenied(
    claim: ImpersonationClaim,
    method: string,
    path: string,
  ): Promise<void> {
    const session = await this.impersonation.getById(claim.sessionId).catch(() => null);
    await this.audit
      .write({
        action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_ACTION,
        outcome: 'failure',
        actorUserId: claim.operatorUserId,
        tenantId: session?.tenantId,
        resourceType: 'impersonation_session',
        resourceId: claim.sessionId,
        metadata: {
          targetUserId: session?.targetUserId,
          mode: claim.mode,
          method,
          path,
          denied: true,
        },
      })
      .catch(() => undefined);
  }
}
