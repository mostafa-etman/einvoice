'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { PendingActivationScreen } from '@/components/shell/pending-activation-screen';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const { memberships, tenantId } = useTenant();
  const locale = useLocale();
  const router = useRouter();
  const tStates = useTranslations('common.states');

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/${locale}/login`);
    }
  }, [ready, user, locale, router]);

  if (!ready || !user) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-token-sm text-foreground-muted"
        role="status"
        aria-busy="true"
      >
        {tStates('loading')}
      </div>
    );
  }

  const current = memberships.find((m) => m.tenant.id === tenantId)?.tenant;
  const lifecycle = current?.lifecycleStatus;
  if (lifecycle === 'PENDING' || lifecycle === 'REJECTED' || lifecycle === 'SUSPENDED') {
    return <PendingActivationScreen status={lifecycle} />;
  }

  return <AppShell>{children}</AppShell>;
}
