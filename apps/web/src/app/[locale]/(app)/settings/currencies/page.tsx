'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createExchangeRate,
  enableCurrency,
  listCurrencyCatalog,
  listExchangeRates,
  listTenantCurrencies,
  setDefaultCurrency,
} from '@/lib/api/currencies';
import { useTenant } from '@/lib/tenant-provider';

const rateSchema = z.object({
  baseCurrencyCode: z.string().min(1),
  quoteCurrencyCode: z.string().min(1),
  rate: z.string().min(1),
  effectiveFrom: z.string().min(1),
});

type RateForm = z.infer<typeof rateSchema>;

export default function CurrenciesSettingsPage() {
  const t = useTranslations('settingsCurrencies');
  const { tenantId } = useTenant();
  const qc = useQueryClient();

  const catalog = useQuery({
    queryKey: ['currency-catalog', tenantId],
    queryFn: listCurrencyCatalog,
    enabled: !!tenantId,
  });
  const enabled = useQuery({
    queryKey: ['tenant-currencies', tenantId],
    queryFn: listTenantCurrencies,
    enabled: !!tenantId,
  });
  const rates = useQuery({
    queryKey: ['exchange-rates', tenantId],
    queryFn: listExchangeRates,
    enabled: !!tenantId,
  });

  const enable = useMutation({
    mutationFn: (code: string) => enableCurrency(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-currencies', tenantId] }),
  });
  const setDefault = useMutation({
    mutationFn: (code: string) => setDefaultCurrency(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-currencies', tenantId] }),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<RateForm>({ resolver: zodResolver(rateSchema) });

  const addRate = useMutation({
    mutationFn: (values: RateForm) =>
      createExchangeRate({
        ...values,
        effectiveFrom: new Date(values.effectiveFrom).toISOString(),
      }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['exchange-rates', tenantId] });
    },
  });

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>

      <h2 className="mt-token-lg text-token-lg">{t('catalog')}</h2>
      <ul className="mt-token-sm space-y-token-xs">
        {(catalog.data ?? []).map((c) => (
          <li key={c.code} className="flex items-center gap-token-md text-token-sm">
            <span>
              {c.code} — {c.nameEn}
            </span>
            <button
              type="button"
              className="rounded border border-border px-token-sm py-token-xs"
              onClick={() => enable.mutate(c.code)}
            >
              {t('enable')}
            </button>
          </li>
        ))}
      </ul>

      <h2 className="mt-token-lg text-token-lg">{t('title')}</h2>
      <ul className="mt-token-sm space-y-token-xs">
        {(enabled.data ?? []).map((c) => (
          <li key={c.currencyCode} className="flex items-center gap-token-md text-token-sm">
            <span>
              {c.currencyCode}
              {c.isDefault ? ' ★' : ''}
            </span>
            {!c.isDefault ? (
              <button
                type="button"
                className="rounded border border-border px-token-sm py-token-xs"
                onClick={() => setDefault.mutate(c.currencyCode)}
              >
                {t('setDefault')}
              </button>
            ) : null}
          </li>
        ))}
        {!enabled.data?.length ? (
          <li className="text-foreground/60">{t('empty')}</li>
        ) : null}
      </ul>

      <h2 className="mt-token-lg text-token-lg">{t('rates')}</h2>
      <form
        className="mt-token-sm flex flex-wrap items-end gap-token-md"
        onSubmit={handleSubmit((v) => addRate.mutateAsync(v))}
      >
        <label className="text-token-sm">
          {t('base')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('baseCurrencyCode')}
          />
        </label>
        <label className="text-token-sm">
          {t('quote')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('quoteCurrencyCode')}
          />
        </label>
        <label className="text-token-sm">
          {t('rate')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('rate')}
          />
        </label>
        <label className="text-token-sm">
          From
          <input
            type="datetime-local"
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('effectiveFrom')}
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
        >
          {t('addRate')}
        </button>
      </form>
      <ul className="mt-token-md space-y-token-xs text-token-sm">
        {(rates.data ?? []).map((r) => (
          <li key={r.id}>
            {r.baseCurrencyCode}/{r.quoteCurrencyCode} = {r.rate}
          </li>
        ))}
      </ul>
    </section>
  );
}
