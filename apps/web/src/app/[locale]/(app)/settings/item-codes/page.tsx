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
} from '@/lib/api/item-codes';
import { useTenant } from '@/lib/tenant-provider';

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

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <div className="mt-token-sm flex flex-wrap items-center gap-token-md">
        <button
          type="button"
          disabled={syncRunning}
          onClick={() => sync.mutate()}
          className="rounded border border-border bg-surface px-token-md py-token-sm text-token-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncRunning ? t('syncRunning') : t('syncEta')}
        </button>
        {syncQuery.data?.lastSyncAt ? (
          <p className="text-token-sm text-foreground/70">
            {t('lastSync', {
              at: new Date(syncQuery.data.lastSyncAt).toLocaleString(),
              added: syncQuery.data.added,
              updated: syncQuery.data.updated,
              unchanged: syncQuery.data.unchanged,
            })}
          </p>
        ) : (
          <p className="text-token-sm text-foreground/60">{t('neverSynced')}</p>
        )}
        {sync.error ? (
          <p className="text-token-sm text-danger">
            {sync.error instanceof Error ? sync.error.message : t('syncFailed')}
          </p>
        ) : null}
      </div>

      <form
        className="mt-token-lg flex flex-wrap items-end gap-token-md"
        onSubmit={handleSubmit((v) => create.mutateAsync(v))}
      >
        <label className="text-token-sm">
          {t('type')}
          <select
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('type')}
          >
            <option value="EGS">EGS</option>
            <option value="GS1">GS1</option>
          </select>
        </label>
        <label className="text-token-sm">
          {t('code')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('code')}
          />
        </label>
        <label className="text-token-sm">
          {t('description')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('description')}
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
        >
          {t('create')}
        </button>
      </form>

      <ul className="mt-token-xl space-y-token-sm text-token-sm">
        {(query.data ?? []).map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center gap-token-sm border-b border-border py-token-sm"
          >
            <span>
              [{i.type}] {i.code} — {i.description}
              {!i.isActive ? ` (${t('inactive')})` : ''}
            </span>
            <span
              className={
                i.source === 'ETA'
                  ? 'rounded bg-brand/10 px-token-xs text-token-xs text-brand'
                  : 'rounded bg-foreground/10 px-token-xs text-token-xs'
              }
            >
              {i.source === 'ETA' ? t('sourceEta') : t('sourceLocal')}
            </span>
          </li>
        ))}
        {!query.data?.length ? (
          <li className="text-foreground/60">{t('empty')}</li>
        ) : null}
      </ul>
    </section>
  );
}
