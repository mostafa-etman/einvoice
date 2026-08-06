import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { loadEnv } from '../config/env';
import type { JwtPayload } from './auth.service';
import type { AuthUser } from './current-user.decorator';

/** Impersonation session tokens (platform-admin/impersonation.service.ts) — never carries isPlatformOperator: true. */
export type ImpersonationJwtPayload = {
  sub: string;
  impersonationSessionId: string;
  mode: 'READ_ONLY' | 'WRITE';
  operatorUserId: string;
  isPlatformOperator: false;
};

type AccessTokenPayload = JwtPayload | ImpersonationJwtPayload;

function isImpersonationPayload(
  payload: AccessTokenPayload,
): payload is ImpersonationJwtPayload {
  return 'impersonationSessionId' in payload;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const env = loadEnv();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ACCESS_SECRET,
    });
  }

  validate(payload: AccessTokenPayload): AuthUser {
    if (isImpersonationPayload(payload)) {
      return {
        userId: payload.sub,
        impersonation: {
          sessionId: payload.impersonationSessionId,
          mode: payload.mode,
          operatorUserId: payload.operatorUserId,
        },
      };
    }
    return { userId: payload.sub, email: payload.email };
  }
}
