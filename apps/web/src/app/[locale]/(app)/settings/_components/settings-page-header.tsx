import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

export function SettingsPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useTranslations('settings');
  const tNav = useTranslations('nav');
  const locale = useLocale();

  return (
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[
            { label: tNav('home'), href: `/${locale}` },
            { label: t('title'), href: `/${locale}/settings` },
            { label: title },
          ]}
        />
      }
      title={title}
      subtitle={subtitle}
      actions={actions}
    />
  );
}
