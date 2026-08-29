'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { useTenant } from '@/lib/tenant-provider';

export default function SettingsHubPage() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const { tenantId } = useTenant();

  const links = [
    { href: `/${locale}/settings/company`, label: t('company') },
    { href: `/${locale}/settings/branches`, label: t('branches') },
    { href: `/${locale}/settings/currencies`, label: t('currencies') },
    { href: `/${locale}/settings/eta-credentials`, label: t('eta') },
    {
      href: `/${locale}/settings/eta-document-types`,
      label: t('etaDocumentTypes'),
    },
    { href: `/${locale}/settings/item-codes`, label: t('itemCodes') },
    { href: `/${locale}/settings/invoice-numbering`, label: t('invoiceNumbering') },
  ];

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/70">{t('hubIntro')}</p>
      <CopyableTenantId id={tenantId} className="mt-token-md" />
      <ul className="mt-token-lg flex flex-col gap-token-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-token-md text-brand underline-offset-2 hover:underline"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
