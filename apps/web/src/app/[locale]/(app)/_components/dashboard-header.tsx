'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { ImportIcon, PlusIcon } from './dashboard-icons';

export function DashboardHeader({
  name,
  tenantName,
}: {
  name: string;
  tenantName: string | null;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();

  return (
    <PageHeader
      title={t('greeting', { name })}
      subtitle={
        tenantName
          ? t('subtitle', { tenant: tenantName })
          : t('subtitleGeneric')
      }
      actions={
        <>
          <Button
            variant="secondary"
            iconStart={<ImportIcon />}
            data-testid="dashboard-quick-import"
            onClick={() => router.push(`/${locale}/imports`)}
          >
            {t('importCsv')}
          </Button>
          <Button
            iconStart={<PlusIcon />}
            data-testid="dashboard-quick-new"
            onClick={() => router.push(`/${locale}/documents/new`)}
          >
            {t('newDocument')}
          </Button>
        </>
      }
    />
  );
}
