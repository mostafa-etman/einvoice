'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createItemCode, listItemCodes } from '@/lib/api/item-codes';
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

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <button
        type="button"
        disabled
        title={t('syncDisabled')}
        className="mt-token-sm cursor-not-allowed rounded border border-border px-token-md py-token-sm text-token-sm opacity-50"
      >
        {t('syncEta')}
      </button>

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
          <li key={i.id} className="border-b border-border py-token-sm">
            [{i.type}] {i.code} — {i.description}
            {!i.isActive ? ' (inactive)' : ''}
          </li>
        ))}
        {!query.data?.length ? (
          <li className="text-foreground/60">{t('empty')}</li>
        ) : null}
      </ul>
    </section>
  );
}
