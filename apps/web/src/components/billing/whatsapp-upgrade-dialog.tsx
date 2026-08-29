'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { fetchActivationHelp } from '@/lib/api/tenants';
import {
  FALLBACK_WHATSAPP_DISPLAY,
  FALLBACK_WHATSAPP_URL,
  whatsappUrlWithText,
} from '@/lib/support-whatsapp';

export type BillingInterest = {
  planCode: string;
  planLabel: string;
};

export function WhatsAppUpgradeDialog({
  open,
  interest,
  onClose,
}: {
  open: boolean;
  interest: BillingInterest | null;
  onClose: () => void;
}) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const helpQuery = useQuery({
    queryKey: ['activation-help'],
    queryFn: fetchActivationHelp,
    enabled: open,
  });
  const display = helpQuery.data?.whatsappDisplay ?? FALLBACK_WHATSAPP_DISPLAY;
  const baseUrl = helpQuery.data?.whatsappUrl ?? FALLBACK_WHATSAPP_URL;
  const prefill = interest
    ? t('whatsappPrefill', { plan: interest.planLabel })
    : t('whatsappPrefillGeneric');
  const href = whatsappUrlWithText(baseUrl, prefill);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-token-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-upgrade-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded border border-border bg-surface p-token-lg shadow-xl"
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="whatsapp-upgrade-title" className="font-display text-token-lg text-brand">
          {t('whatsappUpgradeTitle')}
        </h2>
        <p className="mt-token-md text-token-md text-foreground/90">
          {t('whatsappUpgradeBody', { number: display })}
        </p>
        {interest ? (
          <p className="mt-token-sm text-token-sm text-muted-foreground">
            {t('whatsappInterestedPlan', { plan: interest.planLabel })}
          </p>
        ) : null}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-token-lg inline-flex w-full items-center justify-center rounded bg-brand px-token-md py-token-sm text-white"
          dir="ltr"
        >
          {t('whatsappCta')} · {display}
        </a>
        <button
          type="button"
          className="mt-token-sm w-full rounded border border-border px-token-md py-token-sm text-token-sm hover:bg-brand-muted"
          onClick={onClose}
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
}
