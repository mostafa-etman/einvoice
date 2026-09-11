'use client';

import { useTranslations } from 'next-intl';
import { useOptionalToast } from './toast';

export function useMutationToast() {
  const { push } = useOptionalToast();
  const t = useTranslations('common.toast');

  const success = (title?: string) => {
    push({ kind: 'success', title: title ?? t('success') });
  };

  const error = (err?: unknown, fallback?: string) => {
    const message =
      err instanceof Error && err.message ? err.message : (fallback ?? t('error'));
    push({ kind: 'error', title: message });
  };

  return {
    saved: () => success(t('saved')),
    created: () => success(t('created')),
    deleted: () => success(t('deleted')),
    success,
    error,
    track: async <T>(promise: Promise<T>, okTitle?: string): Promise<T> => {
      try {
        const value = await promise;
        success(okTitle);
        return value;
      } catch (err) {
        error(err);
        throw err;
      }
    },
  };
}
