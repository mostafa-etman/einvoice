'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-provider';
import { TenantSwitcher } from '@/components/switchers/tenant-switcher';
import { BranchSwitcher } from '@/components/switchers/branch-switcher';
import { EtaEnvironmentBadge } from '@/components/shell/eta-environment-badge';
import { getSidebarCollapsed, setSidebarCollapsed } from '@/lib/session';

type NavIcon =
  | 'home'
  | 'documents'
  | 'sync'
  | 'analytics'
  | 'reports'
  | 'backup'
  | 'billing'
  | 'purchases'
  | 'imports'
  | 'exports'
  | 'devices'
  | 'users'
  | 'roles'
  | 'settings';

function NavGlyph({ name }: { name: NavIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'h-5 w-5 shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
        </svg>
      );
    case 'documents':
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case 'sync':
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 0 1-15.5 6.4M3 12a9 9 0 0 1 15.5-6.4" />
          <path d="M21 4v5h-5M3 20v-5h5" />
        </svg>
      );
    case 'analytics':
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16" />
          <path d="M8 16v-5M12 16V8M16 16v-8" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M4 4h16v16H4z" />
          <path d="M8 14v2M12 10v6M16 7v9" />
        </svg>
      );
    case 'backup':
      return (
        <svg {...common}>
          <path d="M12 3v10M8 9l4 4 4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      );
    case 'billing':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18M7 14h4" />
        </svg>
      );
    case 'purchases':
      return (
        <svg {...common}>
          <path d="M6 6h15l-1.5 9H8L6 6z" />
          <path d="M6 6 5 3H2M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
        </svg>
      );
    case 'imports':
      return (
        <svg {...common}>
          <path d="M12 3v12M8 11l4 4 4-4" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'exports':
      return (
        <svg {...common}>
          <path d="M12 15V3M8 7l4-4 4 4" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'devices':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="12" rx="1.5" />
          <path d="M9 20h6M12 16v4" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M21 19c0-2.2-1.5-3.8-3.5-4.4" />
        </svg>
      );
    case 'roles':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
          <path d="M16 4.5 19 6l-3 1.5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
      );
    default:
      return null;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(getSidebarCollapsed());
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  };

  const switchLocale = (next: string) => {
    const rest = pathname.replace(/^\/(ar|en)/, '') || '';
    router.replace(`/${next}${rest}`);
  };

  const nav: Array<{ href: string; label: string; icon: NavIcon }> = [
    { href: `/${locale}`, label: t('nav.home'), icon: 'home' },
    { href: `/${locale}/documents`, label: t('nav.documents'), icon: 'documents' },
    { href: `/${locale}/sync`, label: t('nav.sync'), icon: 'sync' },
    { href: `/${locale}/analytics`, label: t('nav.analytics'), icon: 'analytics' },
    { href: `/${locale}/reports`, label: t('nav.reports'), icon: 'reports' },
    { href: `/${locale}/backup`, label: t('nav.backup'), icon: 'backup' },
    { href: `/${locale}/billing`, label: t('nav.billing'), icon: 'billing' },
    { href: `/${locale}/purchases`, label: t('nav.purchases'), icon: 'purchases' },
    { href: `/${locale}/imports`, label: t('nav.imports'), icon: 'imports' },
    { href: `/${locale}/exports`, label: t('nav.exports'), icon: 'exports' },
    { href: `/${locale}/devices`, label: t('nav.devices'), icon: 'devices' },
    { href: `/${locale}/users`, label: t('nav.users'), icon: 'users' },
    { href: `/${locale}/roles`, label: t('nav.roles'), icon: 'roles' },
    { href: `/${locale}/settings`, label: t('nav.settings'), icon: 'settings' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside
          className={
            'hidden shrink-0 border-e border-border bg-surface transition-[width] duration-200 ease-out md:flex md:flex-col ' +
            (collapsed ? 'w-16 p-token-sm' : 'w-56 p-token-lg')
          }
        >
          <div
            className={
              'flex items-center gap-token-sm ' +
              (collapsed ? 'justify-center' : 'justify-between')
            }
          >
            {!collapsed ? (
              <p className="font-display text-token-lg text-brand">{t('brand')}</p>
            ) : (
              <span className="font-display text-token-sm text-brand" aria-hidden>
                e
              </span>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="rounded border border-border p-token-xs text-foreground/70 hover:bg-brand-muted hover:text-brand"
              aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
              title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
              aria-expanded={!collapsed}
            >
              <svg
                viewBox="0 0 24 24"
                className={
                  'h-4 w-4 transition-transform duration-200 ' +
                  (collapsed ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0')
                }
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M15 6 9 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <nav className="mt-token-xl flex flex-col gap-token-xs">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={
                    'flex items-center gap-token-sm rounded px-token-sm py-token-xs text-token-md hover:bg-brand-muted ' +
                    (collapsed ? 'justify-center' : '') +
                    (active ? ' bg-brand-muted font-medium text-brand' : '')
                  }
                >
                  <NavGlyph name={item.icon} />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-token-md border-b border-border bg-surface px-token-lg py-token-md">
            <TenantSwitcher />
            <BranchSwitcher />
            <EtaEnvironmentBadge />
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
