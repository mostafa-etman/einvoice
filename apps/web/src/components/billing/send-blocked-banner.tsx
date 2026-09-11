'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { fetchSubscription } from '@/lib/api/billing';
import { WhatsAppUpgradeDialog } from '@/components/billing/whatsapp-upgrade-dialog';
import { useTenant } from '@/lib/tenant-provider';
import { Button } from '@/components/ui/button';

function dismissedKey(tenantId: string | null) {
  return `einvoice.sendBlockedBanner.dismissed.${tenantId ?? 'none'}`;
}

export function SendBlockedBanner() {
  const t = useTranslations('billing');
  const tShell = useTranslations('shell');
  const { tenantId } = useTenant();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(dismissedKey(tenantId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [tenantId]);
  const query = useQuery({ queryKey: ['billing-subscription'], queryFn: fetchSubscription });
  const sub = query.data;
  if (!sub?.sendBlocked || dismissed) return null;

  return (
    <>
      <div
        className="flex flex-wrap items-start justify-between gap-token-sm border-b border-warning/30 bg-warning-muted px-token-lg py-token-sm text-token-sm text-foreground"
        role="alert"
      >
        <div className="flex min-w-0 flex-1 items-start gap-token-sm">
          <span
            className="mt-token-2xs inline-flex h-token-md w-token-md shrink-0 items-center justify-center rounded-pill bg-warning text-on-dark"
            aria-hidden
          >
            !
          </span>
          <div>
            <p>{t('sendBlockedMessage')}</p>
            <button
              type="button"
              className="mt-token-xs font-medium text-brand underline"
              onClick={() => setOpen(true)}
            >
              {t('whatsappCta')}
            </button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={tShell('dismissBanner')}
          onClick={() => {
            try {
              sessionStorage.setItem(dismissedKey(tenantId), '1');
            } catch {
              /* private mode */
            }
            setDismissed(true);
          }}
        >
          ×
        </Button>
      </div>
      <WhatsAppUpgradeDialog
        open={open}
        interest={{
          kind: 'renewal',
          planCode: sub.plan.code,
          planLabel: sub.plan.nameAr || sub.plan.name,
        }}
        currentPlanLabel={sub.plan.nameAr || sub.plan.name}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
