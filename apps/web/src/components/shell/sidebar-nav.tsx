'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/tooltip';
import { buildNavGroups, isNavActive } from './nav-config';
import { NavGlyph } from './nav-icons';

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const groups = buildNavGroups(locale);

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-token-md overflow-y-auto" aria-label={t('shell.navigation')}>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-nav-gap">
          {!collapsed ? (
            <div className="mb-token-xs px-nav-x text-nav-group font-semibold uppercase tracking-nav-group text-on-dark-muted">
              {t(group.titleKey)}
            </div>
          ) : null}
          {group.items.map((item) => {
            const active = isNavActive(pathname, item.href, locale);
            const label = t(item.labelKey);
            const link = (
              <Link
                href={item.href}
                title={collapsed ? label : undefined}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-nav-icon rounded-control px-nav-x py-nav-y text-nav transition',
                  collapsed ? 'justify-center' : '',
                  active
                    ? 'bg-brand text-on-dark shadow-nav-active'
                    : 'text-nav hover:bg-nav-hover hover:text-on-dark',
                )}
              >
                <NavGlyph name={item.icon} />
                {!collapsed ? <span className="truncate">{label}</span> : null}
              </Link>
            );
            if (!collapsed) return <div key={item.id}>{link}</div>;
            return (
              <Tooltip key={item.id} content={label} delayMs={200}>
                {link}
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
