'use client';

import { TenantSwitcher } from '@/components/switchers/tenant-switcher';
import { BranchSwitcher } from '@/components/switchers/branch-switcher';
import { EtaEnvironmentBadge } from '@/components/shell/eta-environment-badge';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { ShellBreadcrumbs } from './shell-breadcrumbs';
import { useTranslations } from 'next-intl';

export function Topbar({
  onOpenMobileNav,
  onOpenPalette,
  shortcutHint,
}: {
  onOpenMobileNav: () => void;
  onOpenPalette: () => void;
  shortcutHint: string;
}) {
  const t = useTranslations('shell');

  return (
    <header className="flex flex-col gap-token-sm border-b border-border bg-surface px-topbar-x py-topbar-y">
      <div className="flex flex-wrap items-center gap-token-sm">
        <button
          type="button"
          className="rounded-control p-token-sm text-foreground-muted hover:bg-surface-hover hover:text-foreground md:hidden"
          aria-label={t('openMenu')}
          onClick={onOpenMobileNav}
        >
          <svg viewBox="0 0 24 24" className="h-token-md w-token-md" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <TenantSwitcher />
        <BranchSwitcher />
        <EtaEnvironmentBadge />
        <div className="ms-auto flex flex-wrap items-center gap-token-xs">
          <button
            type="button"
            className="hidden rounded-control p-token-sm text-foreground-muted hover:bg-surface-hover hover:text-foreground sm:inline-flex"
            aria-label={t('quickSearch')}
            title={`${t('quickSearch')} (${shortcutHint})`}
            onClick={onOpenPalette}
          >
            <svg viewBox="0 0 24 24" className="h-token-md w-token-md" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-control p-token-sm text-foreground-muted hover:bg-surface-hover hover:text-foreground"
            aria-label={t('notifications')}
            title={t('notificationsSoon')}
          >
            <svg viewBox="0 0 24 24" className="h-token-md w-token-md" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3s3-2 3-9" />
              <path d="M10 21a2 2 0 0 0 4 0" />
            </svg>
          </button>
          <ThemeToggle />
          <LocaleSwitcher />
          <UserMenu compact tone="on-light" />
        </div>
      </div>
      <ShellBreadcrumbs />
    </header>
  );
}
