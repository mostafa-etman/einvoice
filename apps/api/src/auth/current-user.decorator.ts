import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type ImpersonationClaim = {
  sessionId: string;
  mode: 'READ_ONLY' | 'WRITE';
  operatorUserId: string;
};

export type AuthUser = {
  userId: string;
  /** Absent on impersonation-scoped tokens (see jwt.strategy.ts). */
  email?: string;
  /** Present only when the bearer token is an impersonation session token — never carries isPlatformOperator. */
  impersonation?: ImpersonationClaim;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return req.user;
});
