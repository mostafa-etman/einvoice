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
  type DraftQueueStatus,
} from '@/lib/offline/draft-queue';
import { SyncEngine } from '@/lib/offline/sync-engine';
import { getActiveTenantId } from '@/lib/session';
import { useAuth } from '@/lib/auth-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, type TableColumn } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

const statusVariant: Record<DraftQueueStatus, BadgeVariant> = {
  pending: 'warning',
  syncing: 'info',
  synced: 'success',
  conflict: 'warning',
  failed: 'danger',
};

export default function SyncPage() {
  const t = useTranslations();
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { user } = useAuth();
  const toast = useMutationToast();
  const [items, setItems] = useState<DraftQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drainCount, setDrainCount] = useState(0);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  const tenantId = getActiveTenantId() ?? '';
  const draining = drainCount > 0;

  const refresh = async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setItems(await listDraftsForTenant(tenantId));
    setLoading(false);
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

  async function retrySync() {
    if (!tenantId || !user?.id) return;
    const engine = new SyncEngine({ tenantId, userId: user.id });
    setDrainCount((n) => n + 1);
    try {
      await engine.drain();
      await refresh();
      toast.saved();
    } catch (e) {
      toast.error(e);
    } finally {
      setDrainCount((n) => n - 1);
    }
  }

  async function requestDiscard() {
    if (!tenantId) return;
    const unsynced = await countUnsynced(tenantId);
    if (unsynced > 0) {
      setDiscardOpen(true);
      return;
    }
    await clearTenantQueue(tenantId);
    await refresh();
    toast.deleted();
  }

  async function confirmDiscard() {
    if (!tenantId) return;
    await clearTenantQueue(tenantId);
    setDiscardOpen(false);
    await refresh();
    toast.deleted();
  }

  const columns: TableColumn<DraftQueueItem>[] = [
    {
      id: 'status',
      header: t('sync.statusLabel'),
      cell: (item) => (
        <Badge variant={statusVariant[item.status]}>
          {t(`sync.status.${item.status}` as 'sync.status.pending')}
        </Badge>
      ),
    },
    {
      id: 'key',
      header: t('sync.queueKey'),
      cell: (item) => (
        <span className="font-en text-token-xs" dir="ltr">
          {item.idempotencyKey}
        </span>
      ),
    },
    {
      id: 'updated',
      header: t('sync.updated'),
      cell: (item) => (
        <span className="font-en text-token-xs text-foreground-muted" dir="ltr">
          {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      id: 'error',
      header: t('sync.error'),
      cell: (item) =>
        item.lastError ? (
          <p className="m-0 text-token-xs text-danger" role="alert">
            {item.lastError}
          </p>
        ) : (
          '—'
        ),
    },
    {
      id: 'actions',
      header: t('sync.colActions'),
      align: 'end',
      cell: (item) =>
        item.status === 'conflict' ? (
          <Link
            className="text-brand underline-offset-2 hover:underline"
            href={`/${locale}/sync/conflict?key=${encodeURIComponent(item.idempotencyKey)}`}
          >
            {t('conflict.title')}
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="space-y-token-lg">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('home'), href: `/${locale}` },
              { label: t('sync.title') },
            ]}
          />
        }
        title={t('sync.title')}
        subtitle={t('offline.browserWipeRisk')}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => void requestDiscard()}>
              {t('sync.discardConfirm')}
            </Button>
            <Button type="button" onClick={() => void retrySync()} loading={draining}>
              {t('sync.retry')}
            </Button>
          </>
        }
      />

      <Card aria-busy={draining || undefined}>
        <div className="flex flex-wrap items-center gap-token-sm">
          <Badge variant={online ? 'success' : 'danger'}>
            {online ? t('sync.online') : t('sync.offline')}
          </Badge>
          {draining ? (
            <span className="inline-flex items-center gap-token-xs text-token-sm text-foreground-muted">
              <Spinner />
              {t('sync.syncing')}
            </span>
          ) : null}
        </div>
        <dl className="mt-token-md grid grid-cols-2 gap-token-sm sm:grid-cols-5">
          {(
            [
              ['pending', summary.pending],
              ['syncing', summary.syncing],
              ['conflict', summary.conflict],
              ['failed', summary.failed],
              ['synced', summary.synced],
            ] as const
          ).map(([key, count]) => (
            <div key={key} className="rounded-md border border-border bg-surface-alt px-token-sm py-token-sm">
              <dt className="text-token-xs text-foreground-muted">{t(`sync.${key}`)}</dt>
              <dd className="m-0 mt-token-2xs font-en text-token-lg font-semibold tabular-nums" dir="ltr">
                {count}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {loading ? (
        <Card aria-busy="true">
          <Skeleton className="mb-token-sm" />
          <Skeleton className="mb-token-sm w-2/3" />
          <Skeleton />
        </Card>
      ) : (
        <Table
          caption={t('sync.listCaption')}
          columns={columns}
          rows={items}
          getRowId={(item) => item.idempotencyKey}
          empty={<EmptyState title={t('sync.empty')} action={{ label: t('sync.retry'), onClick: () => void retrySync() }} />}
        />
      )}

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void confirmDiscard()}
        title={t('sync.discardTitle')}
        description={t('sync.discardWarn')}
        confirmLabel={t('sync.discardConfirm')}
        danger
      />
    </div>
  );
}
