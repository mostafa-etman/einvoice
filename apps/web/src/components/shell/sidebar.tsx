'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { XiraLogo } from '@/components/brand/xira-logo';
import { SidebarNav } from './sidebar-nav';

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onOpenPalette,
  shortcutHint,
  userBlock,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenPalette: () => void;
  shortcutHint: string;
  userBlock: ReactNode;
}) {
  const t = useTranslations('shell');

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col gap-token-lg bg-navy text-on-dark transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-sidebar-collapsed px-token-sm py-token-lg' : 'w-sidebar px-token-md py-token-lg',
      )}
    >
      <div className={cn('flex items-center gap-token-sm', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? (
          <XiraLogo variant="on-dark" size="sm" className="[&>div:last-child]:hidden" />
        ) : (
          <XiraLogo variant="on-dark" size="sm" />
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="inline-flex rounded-control p-token-xs text-on-dark-muted hover:bg-nav-hover hover:text-on-dark"
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          aria-expanded={!collapsed}
        >
          <svg
            viewBox="0 0 24 24"
            className={cn(
              'h-token-sm w-token-sm transition-transform duration-200',
              collapsed ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0',
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M15 6 9 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          'flex items-center gap-token-sm rounded-control border border-border-dark bg-nav-search text-nav text-token-sm',
          collapsed ? 'justify-center px-token-xs py-token-sm' : 'px-token-sm py-token-sm',
        )}
        aria-label={t('quickSearch')}
        title={t('quickSearch')}
      >
        <span aria-hidden>🔍</span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-start">{t('quickSearch')}</span>
            <kbd className="rounded-sm bg-nav-kbd px-token-xs py-px font-en text-nav-group text-on-dark-muted">
              {shortcutHint}
            </kbd>
          </>
        ) : null}
      </button>

      <SidebarNav collapsed={collapsed} />

      {userBlock}
    </aside>
  );
}
