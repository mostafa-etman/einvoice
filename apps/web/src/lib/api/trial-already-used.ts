import { ApiError } from './client';

const CODE = 'TRIAL_ALREADY_USED';

export function trialAlreadyUsedMessage(err: unknown, locale: string): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body;
  if (!body || typeof body !== 'object') return null;
  const rec = body as {
    code?: string;
    message?: string;
    messageAr?: string;
    messageEn?: string;
  };
  if (rec.code !== CODE) return null;
  if (locale === 'ar') return rec.messageAr || rec.message || null;
  return rec.messageEn || rec.message || null;
}
