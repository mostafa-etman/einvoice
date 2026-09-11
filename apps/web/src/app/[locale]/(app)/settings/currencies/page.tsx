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
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';
import { QueryErrorCard } from '@/components/ui/query-error-card';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

const rateSchema = z.object({
  baseCurrencyCode: z.string().min(1),
  quoteCurrencyCode: z.string().min(1),
  rate: z.string().min(1),
  effectiveFrom: z.string().min(1),
});

type RateForm = z.infer<typeof rateSchema>;

type CatalogRow = { code: string; nameEn: string };
type EnabledRow = { currencyCode: string; isDefault: boolean };
type RateRow = {
  id: string;
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  rate: string;
};

export default function CurrenciesSettingsPage() {
  const t = useTranslations('settingsCurrencies');
  const tRetry = useTranslations('common.actions');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-currencies', tenantId] });
      toast.saved();
    },
    onError: (err) => toast.error(err),
  });
  const setDefault = useMutation({
    mutationFn: (code: string) => setDefaultCurrency(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-currencies', tenantId] });
      toast.saved();
    },
    onError: (err) => toast.error(err),
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
      toast.created();
    },
    onError: (err) => toast.error(err),
  });

  const catalogColumns: TableColumn<CatalogRow>[] = [
    {
      id: 'code',
      header: t('catalog'),
      ltr: true,
      cell: (c) => `${c.code} — ${c.nameEn}`,
    },
    {
      id: 'enable',
      header: t('enable'),
      align: 'end',
      cell: (c) => (
        <Button type="button" variant="secondary" size="sm" onClick={() => enable.mutate(c.code)}>
          {t('enable')}
        </Button>
      ),
    },
  ];

  const enabledColumns: TableColumn<EnabledRow>[] = [
    {
      id: 'code',
      header: t('title'),
      ltr: true,
      cell: (c) => (
        <span className="inline-flex items-center gap-token-xs">
          {c.currencyCode}
          {c.isDefault ? <Badge variant="info">★</Badge> : null}
        </span>
      ),
    },
    {
      id: 'default',
      header: t('setDefault'),
      align: 'end',
      cell: (c) =>
        c.isDefault ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setDefault.mutate(c.currencyCode)}
          >
            {t('setDefault')}
          </Button>
        ),
    },
  ];

  const rateColumns: TableColumn<RateRow>[] = [
    {
      id: 'pair',
      header: t('rates'),
      ltr: true,
      cell: (r) => `${r.baseCurrencyCode}/${r.quoteCurrencyCode} = ${r.rate}`,
    },
  ];

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader title={t('title')} />

      <section className="space-y-token-sm">
        <h2 className="m-0 text-token-md font-semibold text-foreground">{t('catalog')}</h2>
        {catalog.isError ? (
          <QueryErrorCard
            message={catalog.error instanceof Error ? catalog.error.message : tRetry('retry')}
            retryLabel={tRetry('retry')}
            onRetry={() => void catalog.refetch()}
          />
        ) : catalog.isLoading ? (
          <Card aria-busy="true">
            <Skeleton />
          </Card>
        ) : (
          <Table
            caption={t('catalog')}
            columns={catalogColumns}
            rows={catalog.data ?? []}
            getRowId={(c) => c.code}
            empty={null}
          />
        )}
      </section>

      <section className="space-y-token-sm">
        <h2 className="m-0 text-token-md font-semibold text-foreground">{t('title')}</h2>
        {enabled.isError ? (
          <QueryErrorCard
            message={enabled.error instanceof Error ? enabled.error.message : tRetry('retry')}
            retryLabel={tRetry('retry')}
            onRetry={() => void enabled.refetch()}
          />
        ) : enabled.isLoading ? (
          <Card aria-busy="true">
            <Skeleton />
          </Card>
        ) : (
          <Table
            caption={t('title')}
            columns={enabledColumns}
            rows={enabled.data ?? []}
            getRowId={(c) => c.currencyCode}
            empty={
              <EmptyState
                title={t('empty')}
                action={
                  catalog.data?.[0]
                    ? {
                        label: t('enable'),
                        onClick: () => enable.mutate(catalog.data[0]!.code),
                      }
                    : undefined
                }
              />
            }
          />
        )}
      </section>

      <section className="space-y-token-sm">
        <h2 className="m-0 text-token-md font-semibold text-foreground">{t('rates')}</h2>
        <Card>
          <form
            className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
            onSubmit={handleSubmit((v) => addRate.mutateAsync(v))}
          >
            <Input label={t('base')} dir="ltr" {...register('baseCurrencyCode')} />
            <Input label={t('quote')} dir="ltr" {...register('quoteCurrencyCode')} />
            <Input label={t('rate')} dir="ltr" {...register('rate')} />
            <Input
              type="datetime-local"
              label={t('effectiveFrom')}
              {...register('effectiveFrom')}
            />
            <Button type="submit" disabled={isSubmitting}>
              {t('addRate')}
            </Button>
          </form>
        </Card>
        <Table
          caption={t('rates')}
          columns={rateColumns}
          rows={rates.data ?? []}
          getRowId={(r) => r.id}
          loading={rates.isLoading}
          empty={null}
        />
      </section>
    </div>
  );
}
