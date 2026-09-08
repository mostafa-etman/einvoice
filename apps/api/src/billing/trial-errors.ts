import { HttpException, HttpStatus } from '@nestjs/common';
import {
  TRIAL_ALREADY_USED_CODE,
  trialAlreadyUsedMessages,
} from './tax-registration';

export type TrialAlreadyUsedBody = {
  code: typeof TRIAL_ALREADY_USED_CODE;
  message: string;
  messageAr: string;
  messageEn: string;
  whatsappDisplay: string;
  whatsappUrl: string;
};

export class TrialAlreadyUsedHttpException extends HttpException {
  constructor(whatsappDisplay: string, whatsappUrl: string) {
    const { messageAr, messageEn } = trialAlreadyUsedMessages(whatsappDisplay);
    const body: TrialAlreadyUsedBody = {
      code: TRIAL_ALREADY_USED_CODE,
      message: messageEn,
      messageAr,
      messageEn,
      whatsappDisplay,
      whatsappUrl,
    };
    super(body, HttpStatus.CONFLICT);
  }
}

export function isTrialAlreadyUsedException(err: unknown): err is TrialAlreadyUsedHttpException {
  return err instanceof TrialAlreadyUsedHttpException;
}
