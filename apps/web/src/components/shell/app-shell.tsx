'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-provider';
import { TenantSwitcher } from '@/components/switchers/tenant-switcher';
import { BranchSwitcher } from '@/components/switchers/branch-switcher';

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuth();

  const switchLocale = (next: string) => {
    const rest = pathname.replace(/^\/(ar|en)/, '') || '';
    router.replace(`/${next}${rest}`);
  };

  const nav = [
    { href: `/${locale}`, label: t('nav.home') },
    { href: `/${locale}/documents`, label: t('nav.documents') },
    { href: `/${locale}/purchases`, label: t('nav.purchases') },
    { href: `/${locale}/imports`, label: t('nav.imports') },
    { href: `/${locale}/exports`, label: t('nav.exports') },
    { href: `/${locale}/devices`, label: t('nav.devices') },
    { href: `/${locale}/users`, label: t('nav.users') },
    { href: `/${locale}/roles`, label: t('nav.roles') },
    { href: `/${locale}/settings`, label: t('nav.settings') },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-56 shrink-0 border-e border-border bg-surface p-token-lg md:block">
          <p className="font-display text-token-lg text-brand">{t('brand')}</p>
          <nav className="mt-token-xl flex flex-col gap-token-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-token-sm py-token-xs text-token-md hover:bg-brand-muted ${
                  pathname === item.href ? 'bg-brand-muted font-medium text-brand' : ''
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-token-md border-b border-border bg-surface px-token-lg py-token-md">
            <TenantSwitcher />
            <BranchSwitcher />
            <div className="ms-auto flex items-center gap-token-md">
              <label className="text-token-sm text-foreground/70">
                {t('shell.language')}
                <select
                  className="ms-token-sm rounded border border-border bg-background px-token-sm py-token-xs"
                  value={locale}
                  onChange={(e) => switchLocale(e.target.value)}
                  aria-label={t('shell.language')}
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <span className="text-token-sm text-foreground/70">{user?.email}</span>
              <button
                type="button"
                className="rounded border border-border px-token-sm py-token-xs text-token-sm hover:bg-brand-muted"
                onClick={async () => {
                  await logout();
                  router.push(`/${locale}/login`);
                }}
              >
                {t('nav.logout')}
              </button>
            </div>
          </header>
          <main className="flex-1 p-token-lg">{children}</main>
        </div>
      </div>
    </div>
  );
}
