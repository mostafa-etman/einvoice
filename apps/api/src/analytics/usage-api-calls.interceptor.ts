import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { UsageEmitService } from './usage-emit.service';
import type { AuthUser } from '../auth/current-user.decorator';

const SKIP_PREFIXES = ['/health', '/auth/'];

@Injectable()
export class UsageApiCallsInterceptor implements NestInterceptor {
  constructor(private readonly emit: UsageEmitService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      path: string;
      url?: string;
      user?: AuthUser;
      headers: Record<string, string | undefined>;
    }>();

    const path = req.path || req.url || '';
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) {
      return next.handle();
    }

    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId || !req.user?.userId) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.emit
            .emitApiCall({
              tenantId,
              path,
              method: req.method,
            })
            .catch(() => undefined);
        },
      }),
    );
  }
}
