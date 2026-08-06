'use client';

import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDraft, putDraft, type DraftQueueItem } from '@/lib/offline/draft-queue';
import { resolveSyncConflict, type DraftSyncBody } from '@/lib/api/sync';

export default function ConflictPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const key = params.get('key') ?? '';
  const [item, setItem] = useState<DraftQueueItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    void getDraft(key).then((d) => setItem(d ?? null));
  }, [key]);

  const resolve = async (resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED') => {
    if (!item?.lastError && !item) return;
    setError(null);
    try {
      // conflictId is stored in lastError metadata only when synced from API;
      // prefer payload.conflictId if present after 409 handling.
      const conflictId =
        (item.payload.__conflictId as string | undefined) ??
        (typeof item.lastError === 'string' && item.lastError.length >= 8
          ? item.lastError
          : null);
      if (!conflictId || conflictId === 'conflict') {
        setError('Missing conflict id — re-sync to open conflict');
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
      router.push(`/${locale}/sync`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'resolve failed');
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-token-lg">
      <h1 className="font-display text-token-2xl text-brand">{t('conflict.title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/80">{t('conflict.intro')}</p>
      {item ? (
        <p className="mt-token-md text-token-sm text-foreground/60">{item.idempotencyKey}</p>
      ) : null}
      {error ? <p className="mt-token-sm text-red-700">{error}</p> : null}
      <div className="mt-token-xl flex flex-wrap gap-token-sm">
        <button
          type="button"
          className="rounded bg-brand px-token-md py-token-sm text-white"
          onClick={() => void resolve('KEEP_LOCAL')}
        >
          {t('conflict.keepLocal')}
        </button>
        <button
          type="button"
          className="rounded border border-border px-token-md py-token-sm"
          onClick={() => void resolve('KEEP_SERVER')}
        >
          {t('conflict.keepServer')}
        </button>
        <button
          type="button"
          className="rounded border border-border px-token-md py-token-sm"
          onClick={() => void resolve('MERGED')}
        >
          {t('conflict.merge')}
        </button>
      </div>
    </main>
  );
}
