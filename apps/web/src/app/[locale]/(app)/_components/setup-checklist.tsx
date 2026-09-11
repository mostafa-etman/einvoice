'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

export type ChecklistItemId = 'company' | 'eta' | 'document' | 'user';

export type ChecklistItem = {
  id: ChecklistItemId;
  done: boolean;
  href: string;
};

export function SetupChecklist({
  items,
  loading,
}: {
  items: ChecklistItem[];
  loading: boolean;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const done = items.filter((item) => item.done).length;
  const total = items.length;

  const labels: Record<ChecklistItemId, string> = {
    company: t('checklistCompany'),
    eta: t('checklistEta'),
    document: t('checklistDocument'),
    user: t('checklistUser'),
  };

  return (
    <Card data-testid="dashboard-checklist">
      <CardTitle>{t('checklistTitle')}</CardTitle>
      {loading ? (
        <div className="mt-token-md flex flex-col gap-token-sm" data-testid="dashboard-checklist-loading">
          <Skeleton className="h-token-xs w-full" />
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        <>
          <CardDescription className="mb-token-md">
            {t('checklistProgress', { done, total })}
          </CardDescription>
          <Progress
            className="mb-token-md"
            value={total === 0 ? 0 : (done / total) * 100}
            label={t('checklistProgress', { done, total })}
          />
          <ul className="m-0 flex list-none flex-col gap-token-sm p-0 text-token-sm">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-token-sm">
                <span aria-hidden>{item.done ? '✅' : '◯'}</span>
                <Link
                  href={`/${locale}${item.href}`}
                  className={cn(
                    'rounded-sm focus-visible:outline-none focus-visible:shadow-ring',
                    item.done ? 'text-foreground' : 'text-foreground-muted',
                  )}
                >
                  {labels[item.id]}
                  <span className="sr-only">
                    {item.done ? t('checklistDone') : t('checklistTodo')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
