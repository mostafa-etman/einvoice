'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-provider';
import { XiraLogo } from '@/components/brand/xira-logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeToggle } from '@/components/shell/theme-toggle';

/**
 * The platform-admin console is intentionally separate from the tenant
 * `AppShell` — it is not tenant-scoped (no TenantSwitcher/BranchSwitcher) and
 * is gated server-side by `PlatformAdminGuard` (isPlatformOperator), not RBAC.
 */
export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const t = useTranslations('admin');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/${locale}/login`);
    }
  }, [ready, user, locale, router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton variant="rect" className="h-token-lg w-1/3" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-token-md border-b border-border bg-surface px-token-lg py-token-md">
        <div className="min-w-0">
          <XiraLogo variant="on-light" size="sm" />
          <p className="m-0 mt-token-2xs text-token-xs text-foreground-muted">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-token-sm">
          <span className="font-en text-token-sm text-foreground-muted" dir="ltr">
            {user.email}
          </span>
          <ThemeToggle />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              await logout();
              router.push(`/${locale}/login`);
            }}
          >
            {tNav('logout')}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-token-lg">{children}</main>
    </div>
  );
}
