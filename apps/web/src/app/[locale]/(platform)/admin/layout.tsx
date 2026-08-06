'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-provider';

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
      <div className="flex min-h-screen items-center justify-center text-sm text-foreground/70">
        …
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <div>
          <p className="font-display text-lg text-brand">{t('title')}</p>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-foreground/70">{user.email}</span>
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-brand-muted"
            onClick={async () => {
              await logout();
              router.push(`/${locale}/login`);
            }}
          >
            {tNav('logout')}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
