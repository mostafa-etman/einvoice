'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { fetchActivationHelp } from '@/lib/api/tenants';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';
import { TenantSwitcher } from '@/components/switchers/tenant-switcher';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LocaleSwitcher } from '@/components/shell/locale-switcher';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import {
  FALLBACK_WHATSAPP_DISPLAY,
  FALLBACK_WHATSAPP_URL,
  buildWhatsAppUpgradeMessage,
  whatsappUrlWithText,
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
  const { tenantId, memberships } = useTenant();
  const companyName = memberships.find((m) => m.tenant.id === tenantId)?.tenant.name ?? null;
  const helpQuery = useQuery({
    queryKey: ['activation-help'],
    queryFn: fetchActivationHelp,
  });
  const display = helpQuery.data?.whatsappDisplay ?? FALLBACK_WHATSAPP_DISPLAY;
  const baseUrl = helpQuery.data?.whatsappUrl ?? FALLBACK_WHATSAPP_URL;
  const prefill = buildWhatsAppUpgradeMessage({
    locale,
    kind: 'activation',
    tenantId,
    companyName,
    userName: user?.name,
    userEmail: user?.email,
  });
  const url = whatsappUrlWithText(baseUrl, prefill);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-token-md border-b border-border bg-surface px-topbar-x py-topbar-y">
        <TenantSwitcher />
        <div className="ms-auto flex items-center gap-token-sm">
          <ThemeToggle />
          <LocaleSwitcher />
          {user?.isPlatformOperator ? (
            <a className="text-token-sm text-brand underline" href={`/${locale}/admin`}>
              {t('openAdmin')}
            </a>
          ) : null}
          <span className="text-token-sm text-foreground-muted">{user?.email}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await logout();
              router.push(`/${locale}/login`);
            }}
          >
            {t('logout')}
          </Button>
        </div>
      </header>
      <main className="mx-auto flex max-w-lg flex-1 flex-col justify-center px-token-lg py-token-xl">
        <Card>
          <CardBody>
            <EmptyState
              title={t(`${status}.title`)}
              description={t(`${status}.body`)}
            />
            {status === 'PENDING' || status === 'REJECTED' ? (
              <p className="mt-token-lg text-center text-token-sm text-foreground-muted" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                {t('whatsappPrompt', { number: display })}
              </p>
            ) : null}
            <div className="mt-token-lg flex justify-center">
              <CopyableTenantId id={tenantId} />
            </div>
            <div className="mt-token-lg flex justify-center">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-button bg-brand px-button-x py-button-y text-button font-medium text-on-dark shadow-xs hover:bg-brand-strong hover:shadow-brand"
              >
                {t('whatsappCta')}
              </a>
            </div>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
