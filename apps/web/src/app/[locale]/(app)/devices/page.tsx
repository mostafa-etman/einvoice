'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  createPairingCode,
  listDevices,
  unpairDevice,
  type DeviceSummary,
  type PairingCodeCreated,
} from '@/lib/api/devices';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { FilterBar } from '@/components/ui/filter-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { CopyButton } from '@/components/ui/copy-button';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

function deviceStatusVariant(status: string): BadgeVariant {
  const upper = status.toUpperCase();
  if (upper === 'PAIRED') return 'success';
  if (upper === 'REVOKED') return 'danger';
  return 'neutral';
}

export default function DevicesPage() {
  const t = useTranslations('devices');
  const tNav = useTranslations('nav');
  const tUi = useTranslations('ui');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();
  const [freshCode, setFreshCode] = useState<PairingCodeCreated | null>(null);
  const [search, setSearch] = useState('');
  const [unpairId, setUnpairId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['devices', tenantId],
    queryFn: async () => {
      const res = await listDevices();
      return res.items;
    },
    enabled: !!tenantId,
  });

  const createCode = useMutation({
    mutationFn: createPairingCode,
    onSuccess: (data) => {
      setFreshCode(data);
      toast.created();
    },
    onError: (err) => {
      toast.error(err);
    },
  });

  const unpair = useMutation({
    mutationFn: (id: string) => unpairDevice(id),
    onSuccess: async () => {
      setFreshCode(null);
      setUnpairId(null);
      await qc.invalidateQueries({ queryKey: ['devices', tenantId] });
      toast.saved();
    },
    onError: (err) => {
      toast.error(err);
    },
  });

  const forbidden =
    (query.error instanceof ApiError && query.error.status === 403) ||
    (createCode.error instanceof ApiError && createCode.error.status === 403);

  const devices = query.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => d.label.toLowerCase().includes(q) || d.status.toLowerCase().includes(q));
  }, [devices, search]);

  const columns: TableColumn<DeviceSummary>[] = [
    {
      id: 'label',
      header: t('label'),
      cell: (d) => <span className="font-medium text-foreground">{d.label}</span>,
    },
    {
      id: 'status',
      header: t('status'),
      cell: (d) => (
        <Badge variant={deviceStatusVariant(d.status)}>
          <span dir="ltr">{d.status}</span>
        </Badge>
      ),
    },
    {
      id: 'lastSeen',
      header: t('lastSeen'),
      cell: (d) => (
        <span className="font-en text-token-xs text-foreground-muted" dir="ltr">
          {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : t('never')}
        </span>
      ),
    },
    {
      id: 'pairedAt',
      header: t('pairedAt'),
      cell: (d) => (
        <span className="font-en text-token-xs text-foreground-muted" dir="ltr">
          {new Date(d.pairedAt).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('unpair'),
      align: 'end',
      cell: (d) =>
        d.status !== 'REVOKED' ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={unpair.isPending}
            onClick={() => setUnpairId(d.id)}
          >
            {t('unpair')}
          </Button>
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
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <Button
            type="button"
            disabled={createCode.isPending}
            loading={createCode.isPending}
            onClick={() => createCode.mutate()}
          >
            {t('createPairingCode')}
          </Button>
        }
      />

      {forbidden ? (
        <p className="text-token-sm text-danger" role="alert">
          {t('forbidden')}
        </p>
      ) : null}
      {query.isError && !forbidden ? (
        <QueryErrorCard
          message={query.error instanceof Error ? query.error.message : t('errorGeneric')}
          retryLabel={t('retryLoad')}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {freshCode ? (
        <Card>
          <p className="m-0 text-token-sm text-foreground-muted">{t('pairingCodeOnce')}</p>
          <p className="mt-token-sm font-en text-token-lg break-all" dir="ltr">
            {freshCode.code}
          </p>
          <div className="mt-token-sm flex flex-wrap items-center gap-token-sm">
            <CopyButton value={freshCode.code}>{t('pairingCode')}</CopyButton>
            <p className="m-0 text-token-sm text-foreground-muted">
              {t('expiresAt')}:{' '}
              <span className="font-en" dir="ltr">
                {new Date(freshCode.expiresAt).toLocaleString()}
              </span>
            </p>
          </div>
        </Card>
      ) : null}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('searchPlaceholder')}
        onReset={search ? () => setSearch('') : undefined}
      />

      <div aria-busy={query.isLoading || undefined}>
        <Table
          caption={t('listCaption')}
          columns={columns}
          rows={filtered}
          getRowId={(d) => d.id}
          loading={query.isLoading}
          empty={
            <EmptyState
              title={search.trim() ? t('emptyFiltered') : t('empty')}
              action={
                forbidden
                  ? undefined
                  : search.trim()
                    ? { label: tUi('filterReset'), onClick: () => setSearch('') }
                    : { label: t('createPairingCode'), onClick: () => createCode.mutate() }
              }
            />
          }
        />
      </div>

      <ConfirmDialog
        open={unpairId !== null}
        onClose={() => setUnpairId(null)}
        onConfirm={() => {
          if (!unpairId) return;
          unpair.mutate(unpairId);
          setUnpairId(null);
        }}
        title={t('unpairTitle')}
        description={t('unpairConfirm')}
        confirmLabel={t('unpair')}
        danger
        loading={unpair.isPending}
      />
    </div>
  );
}
