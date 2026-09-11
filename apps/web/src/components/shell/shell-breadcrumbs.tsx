'use client';

import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { flattenNav, isNavActive, navHref } from './nav-config';

export function ShellBreadcrumbs() {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const home = navHref(locale, 'home');
  const items = flattenNav(locale);
  const current = items.find((item) => item.id !== 'home' && isNavActive(pathname, item.href, locale));

  if (!current) {
    return <Breadcrumbs items={[{ label: t('nav.home') }]} />;
  }

  return (
    <Breadcrumbs
      items={[
        { label: t('nav.home'), href: home },
        { label: t(current.labelKey) },
      ]}
    />
  );
}
