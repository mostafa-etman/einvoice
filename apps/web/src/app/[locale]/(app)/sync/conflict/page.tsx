'use client';

import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDraft, putDraft, type DraftQueueItem } from '@/lib/offline/draft-queue';
import { resolveSyncConflict, type DraftSyncBody } from '@/lib/api/sync';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

export default function ConflictPage() {
  const t = useTranslations();
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const toast = useMutationToast();
  const router = useRouter();
  const params = useSearchParams();
  const key = params.get('key') ?? '';
  const [item, setItem] = useState<DraftQueueItem | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!key) {
      setLoading(false);
      return;
    }
    void getDraft(key).then((d) => {
      setItem(d ?? null);
      setLoading(false);
    });
  }, [key]);

  const resolve = async (resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED') => {
    if (!item?.lastError && !item) return;
    setError(null);
    setResolving(true);
    try {
      // conflictId is stored in lastError metadata only when synced from API;
      // prefer payload.conflictId if present after 409 handling.
      const conflictId =
        (item.payload.__conflictId as string | undefined) ??
        (typeof item.lastError === 'string' && item.lastError.length >= 8
          ? item.lastError
          : null);
      if (!conflictId || conflictId === 'conflict') {
        setError(t('conflict.missingId'));
        return;
      }
      const result = await resolveSyncConflict(conflictId, {
        resolution,
        mergedPayload:
          resolution === 'MERGED' || resolution === 'KEEP_LOCAL'
            ? (item.payload as DraftSyncBody)
            : undefined,
      });
      await putDraft({
        ...item,
        serverDocumentId: result.id,
        baseRevision: result.syncRevision,
        status: 'synced',
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      });
      toast.saved();
      router.push(`/${locale}/sync`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('conflict.resolveFailed'));
      toast.error(e, t('conflict.resolveFailed'));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-token-lg">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('home'), href: `/${locale}` },
              { label: t('sync.title'), href: `/${locale}/sync` },
              { label: t('conflict.title') },
            ]}
          />
        }
        title={t('conflict.title')}
        subtitle={t('conflict.intro')}
      />

      {loading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-sm" />
          <Skeleton className="w-1/2" />
        </Card>
      ) : null}

      {!loading && !item ? (
        <EmptyState
          title={t('sync.empty')}
          action={{
            label: t('sync.title'),
            onClick: () => router.push(`/${locale}/sync`),
          }}
        />
      ) : null}

      {item ? (
        <Card>
          <p className="m-0 text-token-xs text-foreground-muted">{t('conflict.queueKey')}</p>
          <p className="mt-token-xs font-en text-token-sm" dir="ltr">
            {item.idempotencyKey}
          </p>
          {error ? (
            <p className="mt-token-sm text-token-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-token-xl flex flex-wrap gap-token-sm">
            <Button
              type="button"
              disabled={resolving}
              onClick={() => void resolve('KEEP_LOCAL')}
            >
              {t('conflict.keepLocal')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resolving}
              onClick={() => void resolve('KEEP_SERVER')}
            >
              {t('conflict.keepServer')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resolving}
              onClick={() => void resolve('MERGED')}
            >
              {t('conflict.merge')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
