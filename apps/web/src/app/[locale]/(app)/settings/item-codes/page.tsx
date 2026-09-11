'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createItemCode,
  getLatestItemCodeSync,
  listItemCodes,
  startItemCodeSync,
  type ItemCode,
} from '@/lib/api/item-codes';
import { useTenant } from '@/lib/tenant-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { SettingsPageHeader } from '../_components/settings-page-header';

const schema = z.object({
  type: z.enum(['EGS', 'GS1']),
  code: z.string().min(1),
  description: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export default function ItemCodesPage() {
  const t = useTranslations('settingsItemCodes');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['item-codes', tenantId],
    queryFn: listItemCodes,
    enabled: !!tenantId,
  });

  const syncQuery = useQuery({
    queryKey: ['item-codes-sync', tenantId],
    queryFn: getLatestItemCodeSync,
    enabled: !!tenantId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'EGS' },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => createItemCode(values),
    onSuccess: async () => {
      reset({ type: 'EGS', code: '', description: '' });
      await qc.invalidateQueries({ queryKey: ['item-codes', tenantId] });
    },
  });

  const sync = useMutation({
    mutationFn: startItemCodeSync,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['item-codes-sync', tenantId] });
    },
  });

  const syncStatus = syncQuery.data?.status;
  const syncRunning =
    sync.isPending || syncStatus === 'PENDING' || syncStatus === 'RUNNING';

  useEffect(() => {
    if (syncStatus === 'SUCCEEDED') {
      void qc.invalidateQueries({ queryKey: ['item-codes', tenantId] });
    }
  }, [syncStatus, qc, tenantId]);

  const columns: TableColumn<ItemCode>[] = [
    {
      id: 'type',
      header: t('type'),
      cell: (i) => i.type,
    },
    {
      id: 'code',
      header: t('code'),
      cell: (i) => i.code,
    },
    {
      id: 'description',
      header: t('description'),
      cell: (i) => (
        <span>
          {i.description}
          {!i.isActive ? ` (${t('inactive')})` : ''}
        </span>
      ),
    },
    {
      id: 'source',
      header: t('sourceLocal'),
      cell: (i) => (
        <Badge variant={i.source === 'ETA' ? 'info' : 'neutral'}>
          {i.source === 'ETA' ? t('sourceEta') : t('sourceLocal')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader
        title={t('title')}
        actions={
          <Button type="button" variant="secondary" disabled={syncRunning} onClick={() => sync.mutate()}>
            {syncRunning ? t('syncRunning') : t('syncEta')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-token-md">
        {syncQuery.data?.lastSyncAt ? (
          <p className="text-token-sm text-foreground-muted">
            {t('lastSync', {
              at: new Date(syncQuery.data.lastSyncAt).toLocaleString(),
              added: syncQuery.data.added,
              updated: syncQuery.data.updated,
              unchanged: syncQuery.data.unchanged,
            })}
          </p>
        ) : (
          <p className="text-token-sm text-foreground-muted">{t('neverSynced')}</p>
        )}
        {sync.error ? (
          <p className="text-token-sm text-danger" role="alert">
            {sync.error instanceof Error ? sync.error.message : t('syncFailed')}
          </p>
        ) : null}
      </div>

      <Card>
        <form
          className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={handleSubmit((v) => create.mutateAsync(v))}
        >
          <Select label={t('type')} {...register('type')}>
            <option value="EGS">EGS</option>
            <option value="GS1">GS1</option>
          </Select>
          <Input label={t('code')} {...register('code')} />
          <Input label={t('description')} {...register('description')} />
          <Button type="submit" disabled={isSubmitting}>
            {t('create')}
          </Button>
        </form>
      </Card>

      <Table
        caption={t('title')}
        columns={columns}
        rows={query.data ?? []}
        getRowId={(i) => i.id}
        loading={query.isLoading}
        empty={<EmptyState title={t('empty')} />}
      />
    </div>
  );
}
