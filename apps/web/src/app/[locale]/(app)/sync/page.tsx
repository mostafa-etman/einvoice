'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  clearTenantQueue,
  countUnsynced,
  listDraftsForTenant,
  summarizeStatuses,
  type DraftQueueItem,
} from '@/lib/offline/draft-queue';
import { SyncEngine } from '@/lib/offline/sync-engine';
import { getActiveTenantId } from '@/lib/session';
import { useAuth } from '@/lib/auth-provider';

export default function SyncPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { user } = useAuth();
  const [items, setItems] = useState<DraftQueueItem[]>([]);
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  const tenantId = getActiveTenantId() ?? '';

  const refresh = async () => {
    if (!tenantId) return;
    setItems(await listDraftsForTenant(tenantId));
  };

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void refresh();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [tenantId]);

  const summary = summarizeStatuses(items);

  return (
    <main className="mx-auto max-w-3xl p-token-lg">
      <h1 className="font-display text-token-2xl text-brand">{t('sync.title')}</h1>
      <p className="mt-token-sm text-token-sm text-foreground/70">
        {online ? t('sync.online') : t('sync.offline')}
      </p>
      <p className="mt-token-xs text-token-sm text-foreground/60">
        {t('offline.browserWipeRisk')}
      </p>
      <div className="mt-token-md flex flex-wrap gap-token-sm text-token-sm">
        <span>
          {t('sync.pending')}: {summary.pending}
        </span>
        <span>
          {t('sync.syncing')}: {summary.syncing}
        </span>
        <span>
          {t('sync.conflict')}: {summary.conflict}
        </span>
        <span>
          {t('sync.failed')}: {summary.failed}
        </span>
        <span>
          {t('sync.synced')}: {summary.synced}
        </span>
      </div>
      <div className="mt-token-md flex gap-token-sm">
        <button
          type="button"
          className="rounded border border-border px-token-md py-token-sm text-token-sm"
          onClick={async () => {
            if (!tenantId || !user?.id) return;
            const engine = new SyncEngine({ tenantId, userId: user.id });
            await engine.drain();
            await refresh();
          }}
        >
          {t('sync.retry')}
        </button>
        <button
          type="button"
          className="rounded border border-border px-token-md py-token-sm text-token-sm"
          onClick={async () => {
            if (!tenantId) return;
            const unsynced = await countUnsynced(tenantId);
            if (unsynced > 0 && !window.confirm(t('sync.discardWarn'))) return;
            await clearTenantQueue(tenantId);
            await refresh();
          }}
        >
          {t('sync.discardConfirm')}
        </button>
      </div>
      <ul className="mt-token-xl space-y-token-sm">
        {items.length === 0 ? (
          <li className="text-token-sm text-foreground/60">{t('sync.empty')}</li>
        ) : (
          items.map((item) => (
            <li
              key={item.idempotencyKey}
              className="rounded border border-border p-token-md text-token-sm"
            >
              <div className="flex justify-between gap-token-md">
                <span className="font-medium">
                  {t(`sync.status.${item.status}` as 'sync.status.pending')}
                </span>
                {item.status === 'conflict' ? (
                  <Link
                    className="text-brand underline"
                    href={`/${locale}/sync/conflict?key=${encodeURIComponent(item.idempotencyKey)}`}
                  >
                    {t('conflict.title')}
                  </Link>
                ) : null}
              </div>
              <p className="mt-token-xs text-foreground/60">{item.idempotencyKey}</p>
              {item.lastError ? (
                <p className="mt-token-xs text-red-700">{item.lastError}</p>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
