'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { fetchActivationHelp } from '@/lib/api/tenants';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import {
  FALLBACK_WHATSAPP_DISPLAY,
  FALLBACK_WHATSAPP_URL,
  buildWhatsAppUpgradeMessage,
  whatsappUrlWithText,
  type WhatsAppRequestKind,
} from '@/lib/support-whatsapp';

export type BillingInterest = {
  kind: WhatsAppRequestKind;
  planCode: string;
  planLabel: string;
};

export function WhatsAppUpgradeDialog({
  open,
  interest,
  currentPlanLabel,
  onClose,
}: {
  open: boolean;
  interest: BillingInterest | null;
  currentPlanLabel?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const { user } = useAuth();
  const { tenantId, memberships } = useTenant();
  const helpQuery = useQuery({
    queryKey: ['activation-help'],
    queryFn: fetchActivationHelp,
    enabled: open,
  });
  const display = helpQuery.data?.whatsappDisplay ?? FALLBACK_WHATSAPP_DISPLAY;
  const baseUrl = helpQuery.data?.whatsappUrl ?? FALLBACK_WHATSAPP_URL;
  const companyName = memberships.find((m) => m.tenant.id === tenantId)?.tenant.name ?? null;
  const kind: WhatsAppRequestKind = interest?.kind ?? 'upgrade';
  const requestedPlan =
    kind === 'points' || kind === 'activation' || kind === 'renewal' ? null : interest?.planLabel;
  const prefill = buildWhatsAppUpgradeMessage({
    locale,
    kind,
    tenantId,
    companyName,
    currentPlan: currentPlanLabel,
    requestedPlan,
    userName: user?.name,
    userEmail: user?.email,
  });
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
        {interest && kind !== 'points' ? (
          <p className="mt-token-sm text-token-sm text-muted-foreground">
            {t('whatsappInterestedPlan', { plan: interest.planLabel })}
          </p>
        ) : null}
        <CopyableTenantId id={tenantId} className="mt-token-md" />
        <pre
          className="mt-token-md max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-token-sm text-token-sm"
          dir="auto"
        >
          {prefill}
        </pre>
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
