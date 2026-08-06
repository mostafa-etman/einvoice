'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { REPORT_CATALOG } from '@/lib/api/reports';

export default function ReportsHubPage() {
  const t = useTranslations('reports');
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
    <div className="space-y-token-lg p-token-lg">
      <header className="space-y-token-xs">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-2xl text-sm text-muted">{t('subtitle')}</p>
        <p className="text-xs text-muted">{t('vsAnalytics')}</p>
      </header>

      {groups.map((g) => (
        <section key={g.key} className="space-y-token-sm">
          <h2 className="text-lg font-medium">{t(`groups.${g.key}`)}</h2>
          <ul className="grid gap-token-sm sm:grid-cols-2">
            {g.ids.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/${locale}/reports/${r.id}`}
                  className="block rounded-md border border-border bg-surface px-token-md py-token-md transition hover:border-foreground/30"
                >
                  <div className="font-medium">
                    {r.id} — {t(`catalog.${r.id}.name`)}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {t(`catalog.${r.id}.desc`)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
