'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createBranch, listBranches } from '@/lib/api/branches';
import { useTenant } from '@/lib/tenant-provider';

const schema = z.object({
  name: z.string().min(1),
  etaBranchCode: z.string().optional(),
  activityCode: z.string().optional(),
  isDefault: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function BranchesSettingsPage() {
  const t = useTranslations('settingsBranches');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
    enabled: !!tenantId,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { isDefault: false },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => createBranch(values),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['branches', tenantId] });
    },
  });

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <form
        className="mt-token-lg flex flex-wrap items-end gap-token-md"
        onSubmit={handleSubmit((v) => create.mutateAsync(v))}
      >
        <label className="text-token-sm">
          {t('name')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('name')}
          />
        </label>
        <label className="text-token-sm">
          {t('etaBranchCode')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('etaBranchCode')}
          />
        </label>
        <label className="text-token-sm">
          {t('activityCode')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('activityCode')}
          />
        </label>
        <label className="flex items-center gap-token-xs text-token-sm">
          <input type="checkbox" {...register('isDefault')} />
          {t('default')}
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
        >
          {t('create')}
        </button>
      </form>

      <ul className="mt-token-xl space-y-token-sm">
        {(query.data ?? []).map((b) => (
          <li key={b.id} className="border-b border-border py-token-sm text-token-sm">
            <span className="font-medium">{b.name}</span>
            {b.isDefault ? ` · ${t('default')}` : ''}
            {b.isActive ? ` · ${t('active')}` : ''}
            {b.activityCode ? ` · ${b.activityCode}` : ''}
          </li>
        ))}
        {!query.data?.length ? (
          <li className="text-token-sm text-foreground/60">{t('empty')}</li>
        ) : null}
      </ul>
    </section>
  );
}
