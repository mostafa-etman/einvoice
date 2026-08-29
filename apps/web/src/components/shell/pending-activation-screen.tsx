'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { fetchActivationHelp } from '@/lib/api/tenants';
import { useAuth } from '@/lib/auth-provider';
import { TenantSwitcher } from '@/components/switchers/tenant-switcher';
import {
  FALLBACK_WHATSAPP_DISPLAY,
  FALLBACK_WHATSAPP_URL,
} from '@/lib/support-whatsapp';

export function PendingActivationScreen({
  status,
}: {
  status: 'PENDING' | 'REJECTED' | 'SUSPENDED';
}) {
  const t = useTranslations('pending');
  const locale = useLocale();
  const router = useRouter();
  const { logout, user } = useAuth();
  const helpQuery = useQuery({
    queryKey: ['activation-help'],
    queryFn: fetchActivationHelp,
  });
  const display = helpQuery.data?.whatsappDisplay ?? FALLBACK_WHATSAPP_DISPLAY;
  const url = helpQuery.data?.whatsappUrl ?? FALLBACK_WHATSAPP_URL;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-token-md border-b border-border bg-surface px-token-lg py-token-md">
        <TenantSwitcher />
        <div className="ms-auto flex items-center gap-token-md">
          {user?.isPlatformOperator ? (
            <a className="text-token-sm text-brand underline" href={`/${locale}/admin`}>
              {t('openAdmin')}
            </a>
          ) : null}
          <span className="text-token-sm text-foreground/70">{user?.email}</span>
          <button
            type="button"
            className="rounded border border-border px-token-sm py-token-xs text-token-sm hover:bg-brand-muted"
            onClick={async () => {
              await logout();
              router.push(`/${locale}/login`);
            }}
          >
            {t('logout')}
          </button>
        </div>
      </header>
      <main className="mx-auto flex max-w-lg flex-1 flex-col justify-center px-token-lg py-token-xl text-center">
        <h1 className="font-display text-token-xl text-brand">{t(`${status}.title`)}</h1>
        <p className="mt-token-md text-token-md text-foreground/80">{t(`${status}.body`)}</p>
        {status === 'PENDING' || status === 'REJECTED' ? (
          <p className="mt-token-lg text-token-md" dir="rtl">
            {t('whatsappPrompt', { number: display })}
          </p>
        ) : null}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-token-lg inline-flex items-center justify-center rounded bg-brand px-token-md py-token-sm text-white"
        >
          {t('whatsappCta')}
        </a>
      </main>
    </div>
  );
}
