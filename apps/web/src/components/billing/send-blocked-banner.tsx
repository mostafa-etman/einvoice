'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { fetchSubscription } from '@/lib/api/billing';
import { WhatsAppUpgradeDialog } from '@/components/billing/whatsapp-upgrade-dialog';

export function SendBlockedBanner() {
  const t = useTranslations('billing');
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ['billing-subscription'], queryFn: fetchSubscription });
  const sub = query.data;
  if (!sub?.sendBlocked) return null;

  return (
    <>
      <div className="border-b border-red-200 bg-red-50 px-token-lg py-token-sm text-sm text-red-800" role="alert">
        <p>{t('sendBlockedMessage')}</p>
        <button type="button" className="mt-1 font-medium underline" onClick={() => setOpen(true)}>
          {t('whatsappCta')}
        </button>
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
