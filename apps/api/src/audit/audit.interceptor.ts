import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import type { AuthUser } from '../auth/current-user.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      path: string;
      user?: AuthUser;
      headers: Record<string, string | undefined>;
    }>();
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }
    if (req.path.startsWith('/auth/')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit
            .write({
              action: `http.${method.toLowerCase()}`,
              outcome: 'success',
              actorUserId: req.user?.userId,
              tenantId: req.headers['x-tenant-id'] ?? null,
              resourceType: req.path,
            })
            .catch(() => undefined);
        },
      }),
    );
  }
}
