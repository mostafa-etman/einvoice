import { HttpException, HttpStatus } from '@nestjs/common';

export type InsufficientPointsBody = {
  code: 'INSUFFICIENT_POINTS';
  required: number;
  balance: number;
  message: string;
  whatsappUrl: string;
  whatsappDisplay: string;
};

export class InsufficientPointsError extends Error {
  constructor(
    public readonly required: number,
    public readonly balance: number,
    public readonly whatsappUrl: string,
    public readonly whatsappDisplay: string,
  ) {
    super(
      `Insufficient points: ${balance} available, ${required} required. Top up via WhatsApp ${whatsappDisplay}`,
    );
    this.name = 'InsufficientPointsError';
  }
}

export function insufficientPointsBody(err: InsufficientPointsError): InsufficientPointsBody {
  return {
    code: 'INSUFFICIENT_POINTS',
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
