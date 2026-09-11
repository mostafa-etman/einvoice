'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { SettingsGroupTitle, SettingsTile } from './_components/settings-tile';

function IconBuilding() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M3 21h18M6 21V7l6-4 6 4v14" />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 22V4l16 8-16 10z" />
    </svg>
  );
}

function IconNumbering() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 118 0v4" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function IconCurrency() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8M12 8v8" />
    </svg>
  );
}

function IconCatalog() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M20 7L12 3 4 7v10l8 4 8-4V7z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </svg>
  );
}

export default function SettingsHubPage() {
  const t = useTranslations('settings');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { tenantId } = useTenant();

  const company = [
    {
      href: `/${locale}/settings/company`,
      label: t('company'),
      description: t('cardCompany'),
      icon: <IconBuilding />,
    },
    {
      href: `/${locale}/settings/branches`,
      label: t('branches'),
      description: t('cardBranches'),
      icon: <IconBranch />,
    },
    {
      href: `/${locale}/settings/invoice-numbering`,
      label: t('invoiceNumbering'),
      description: t('cardNumbering'),
      icon: <IconNumbering />,
    },
  ];

  const eta = [
    {
      href: `/${locale}/settings/eta-credentials`,
      label: t('eta'),
      description: t('cardEta'),
      icon: <IconLock />,
      tone: 'warn' as const,
    },
    {
      href: `/${locale}/settings/eta-document-types`,
      label: t('etaDocumentTypes'),
      description: t('cardDocTypes'),
      icon: <IconDoc />,
      tone: 'teal' as const,
    },
  ];

  const catalog = [
    {
      href: `/${locale}/settings/currencies`,
      label: t('currencies'),
      description: t('cardCurrencies'),
      icon: <IconCurrency />,
    },
    {
      href: `/${locale}/settings/item-codes`,
      label: t('itemCodes'),
      description: t('cardItemCodes'),
      icon: <IconCatalog />,
    },
  ];

  return (
    <div className="space-y-token-lg" data-testid="settings-hub">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('home'), href: `/${locale}` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        subtitle={t('hubIntro')}
      />
      <CopyableTenantId id={tenantId} />

      <section className="space-y-token-sm">
        <SettingsGroupTitle>{t('groupCompany')}</SettingsGroupTitle>
        <div className="grid grid-cols-1 gap-token-md sm:grid-cols-2 xl:grid-cols-3">
          {company.map((item) => (
            <SettingsTile key={item.href} href={item.href} title={item.label} description={item.description} icon={item.icon} />
          ))}
        </div>
      </section>

      <section className="space-y-token-sm">
        <SettingsGroupTitle>{t('groupEta')}</SettingsGroupTitle>
        <div className="grid grid-cols-1 gap-token-md sm:grid-cols-2 xl:grid-cols-3">
          {eta.map((item) => (
            <SettingsTile
              key={item.href}
              href={item.href}
              title={item.label}
              description={item.description}
              icon={item.icon}
              tone={item.tone}
            />
          ))}
        </div>
      </section>

      <section className="space-y-token-sm">
        <SettingsGroupTitle>{t('groupCatalog')}</SettingsGroupTitle>
        <div className="grid grid-cols-1 gap-token-md sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((item) => (
            <SettingsTile key={item.href} href={item.href} title={item.label} description={item.description} icon={item.icon} />
          ))}
        </div>
      </section>
    </div>
  );
}
