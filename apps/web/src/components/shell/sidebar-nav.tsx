'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-provider';
import { Tooltip } from '@/components/ui/tooltip';
import { buildNavGroups, isNavActive } from './nav-config';
import { NavGlyph, type NavGlyphName } from './nav-icons';

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
  const { user } = useAuth();
  const groups = buildNavGroups(locale);
  const adminHref = `/${locale}/admin`;
  const adminLabel = t('nav.platformAdmin');
  const showPlatformAdmin = Boolean(user?.isPlatformOperator);

  const renderLink = (opts: {
    key: string;
    href: string;
    label: string;
    icon: NavGlyphName;
  }) => {
    const active = isNavActive(pathname, opts.href, locale);
    const link = (
      <Link
        href={opts.href}
        title={collapsed ? opts.label : undefined}
        aria-label={opts.label}
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
        <NavGlyph name={opts.icon} />
        {!collapsed ? <span className="truncate">{opts.label}</span> : null}
      </Link>
    );
    if (!collapsed) return <div key={opts.key}>{link}</div>;
    return (
      <Tooltip key={opts.key} content={opts.label} delayMs={200}>
        {link}
      </Tooltip>
    );
  };

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-token-md overflow-y-auto" aria-label={t('shell.navigation')}>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-nav-gap">
          {!collapsed ? (
            <div className="mb-token-xs px-nav-x text-nav-group font-semibold uppercase tracking-nav-group text-on-dark-muted">
              {t(group.titleKey)}
            </div>
          ) : null}
          {group.items.map((item) =>
            renderLink({
              key: item.id,
              href: item.href,
              label: t(item.labelKey),
              icon: item.icon,
            }),
          )}
        </div>
      ))}
      {showPlatformAdmin
        ? renderLink({
            key: 'platform-admin',
            href: adminHref,
            label: adminLabel,
            icon: 'admin',
          })
        : null}
    </nav>
  );
}
