import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  TenantContextService,
  type TenantAwareRequest,
} from './tenant-context.service';

/**
 * Runs after JwtAuthGuard. Stamps a membership-verified tenant onto the
 * request (and `X-Tenant-Id`) so handlers never take an unverified client id.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly context: TenantContextService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<TenantAwareRequest>();
    await this.context.bind(req);
    return next.handle();
  }
}
