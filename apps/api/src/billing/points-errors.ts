import { HttpException, HttpStatus } from '@nestjs/common';

export type SendBlockedReason = 'INSUFFICIENT_POINTS' | 'TRIAL_ENDED';

export type InsufficientPointsBody = {
  code: 'INSUFFICIENT_POINTS' | 'TRIAL_ENDED';
  reason: SendBlockedReason;
  required: number;
  balance: number;
  message: string;
  whatsappUrl: string;
  whatsappDisplay: string;
};

export class InsufficientPointsError extends Error {
  readonly reason: SendBlockedReason;

  constructor(
    public readonly required: number,
    public readonly balance: number,
    public readonly whatsappUrl: string,
    public readonly whatsappDisplay: string,
    reason: SendBlockedReason = 'INSUFFICIENT_POINTS',
  ) {
    super(
      `انتهت الفترة التجريبية / نفدت النقاط — للتجديد تواصل واتساب: ${whatsappDisplay}`,
    );
    this.name = 'InsufficientPointsError';
    this.reason = reason;
  }
}

export function insufficientPointsBody(err: InsufficientPointsError): InsufficientPointsBody {
  return {
    code: err.reason,
    reason: err.reason,
    required: err.required,
    balance: err.balance,
    message: err.message,
    whatsappUrl: err.whatsappUrl,
    whatsappDisplay: err.whatsappDisplay,
  };
}

export class InsufficientPointsHttpException extends HttpException {
  constructor(err: InsufficientPointsError) {
    super(insufficientPointsBody(err), HttpStatus.PAYMENT_REQUIRED);
  }
}

export function isTrialExpired(trialEndsAt: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(trialEndsAt && trialEndsAt.getTime() <= now.getTime());
}
