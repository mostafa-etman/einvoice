'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { REPORT_CATALOG } from '@/lib/api/reports';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';

export default function ReportsHubPage() {
  const t = useTranslations('reports');
  const tNav = useTranslations('nav');
  const locale = useLocale();

  const groups = [
    { key: 'sales' as const, ids: REPORT_CATALOG.filter((r) => r.group === 'sales') },
    {
      key: 'purchases' as const,
      ids: REPORT_CATALOG.filter((r) => r.group === 'purchases'),
    },
    {
      key: 'combined' as const,
      ids: REPORT_CATALOG.filter((r) => r.group === 'combined'),
    },
  ];

  return (
    <div className="space-y-token-lg">
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
        subtitle={t('subtitle')}
      />
      <p className="m-0 text-token-xs text-foreground-muted">{t('vsAnalytics')}</p>

      {groups.map((g) => (
        <section key={g.key} className="space-y-token-sm">
          <h2 className="m-0 text-token-lg font-semibold text-foreground">
            {t(`groups.${g.key}`)}
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-token-sm p-0 sm:grid-cols-2">
            {g.ids.map((r) => (
              <li key={r.id}>
                <Link href={`/${locale}/reports/${r.id}`} className="block no-underline">
                  <Card className="h-full transition hover:border-brand">
                    <CardTitle>
                      <span className="font-en" dir="ltr">
                        {r.id}
                      </span>
                      {' — '}
                      {t(`catalog.${r.id}.name`)}
                    </CardTitle>
                    <CardDescription>{t(`catalog.${r.id}.desc`)}</CardDescription>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
