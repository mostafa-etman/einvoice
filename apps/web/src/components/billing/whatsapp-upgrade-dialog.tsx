'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { fetchActivationHelp } from '@/lib/api/tenants';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('whatsappUpgradeTitle')}
      description={t('whatsappUpgradeBody', { number: display })}
      footer={
        <Button type="button" variant="secondary" block onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      {interest && kind !== 'points' ? (
        <p className="text-token-sm text-foreground-muted">
          {t('whatsappInterestedPlan', { plan: interest.planLabel })}
        </p>
      ) : null}
      <CopyableTenantId id={tenantId} className="mt-token-md" />
      <pre
        className="mt-token-md max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-token-sm text-token-sm"
        dir="auto"
      >
        {prefill}
      </pre>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-token-lg inline-flex w-full items-center justify-center rounded-button border border-transparent bg-brand px-button-x py-button-y text-button font-medium text-on-dark shadow-xs hover:bg-brand-strong hover:shadow-brand"
      >
        {t('whatsappCta')} ·{' '}
        <span className="font-en" dir="ltr">
          {display}
        </span>
      </a>
    </Modal>
  );
}
