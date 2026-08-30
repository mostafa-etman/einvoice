import { HttpException, HttpStatus } from '@nestjs/common';

export type LimitResource = 'users' | 'companies';

export class LimitExceededError extends Error {
  constructor(
    public readonly resource: LimitResource,
    public readonly used: number,
    public readonly limit: number,
    public readonly whatsappUrl: string,
    public readonly whatsappDisplay: string,
  ) {
    super(
      resource === 'users'
        ? `User limit reached (${used}/${limit}). Upgrade or buy an extra-user add-on via WhatsApp ${whatsappDisplay}`
        : `Company limit reached (${used}/${limit}). Upgrade or buy an extra-company add-on via WhatsApp ${whatsappDisplay}`,
    );
    this.name = 'LimitExceededError';
  }
}

export type LimitExceededBody = {
  code: 'USER_LIMIT_EXCEEDED' | 'COMPANY_LIMIT_EXCEEDED';
  resource: LimitResource;
  used: number;
  limit: number;
  message: string;
  whatsappUrl: string;
  whatsappDisplay: string;
};

export function limitExceededBody(err: LimitExceededError): LimitExceededBody {
  return {
    code: err.resource === 'users' ? 'USER_LIMIT_EXCEEDED' : 'COMPANY_LIMIT_EXCEEDED',
    resource: err.resource,
    used: err.used,
    limit: err.limit,
    message: err.message,
    whatsappUrl: err.whatsappUrl,
    whatsappDisplay: err.whatsappDisplay,
  };
}

export class LimitExceededHttpException extends HttpException {
  constructor(err: LimitExceededError) {
    super(limitExceededBody(err), HttpStatus.CONFLICT);
  }
}
