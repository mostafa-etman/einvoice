'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changePlan,
  fetchInvoices,
  fetchPlans,
  fetchQuotas,
  fetchSubscription,
  requestEnterprise,
  startCheckout,
} from '@/lib/api/billing';

function QuotaBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const danger = limit > 0 && used >= limit;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-muted">
        <div
          className={`h-full ${danger ? 'bg-red-600' : 'bg-brand'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const qc = useQueryClient();
  const [enterpriseMessage, setEnterpriseMessage] = useState('');
  const [enterpriseSent, setEnterpriseSent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const plansQuery = useQuery({ queryKey: ['billing-plans'], queryFn: fetchPlans });
  const subscriptionQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: fetchSubscription,
  });
  const quotasQuery = useQuery({ queryKey: ['billing-quotas'], queryFn: fetchQuotas });
  const invoicesQuery = useQuery({ queryKey: ['billing-invoices'], queryFn: fetchInvoices });

  const checkoutMut = useMutation({
    mutationFn: (planCode: 'STARTER' | 'PRO') => startCheckout({ planCode }),
    onSuccess: (res) => {
      setActionError(null);
      if (typeof res.checkoutUrl === 'string') {
        window.location.href = res.checkoutUrl;
      }
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : t('error')),
  });

  const changePlanMut = useMutation({
    mutationFn: (planCode: 'FREE' | 'STARTER' | 'PRO') => changePlan(planCode),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['billing-subscription'] });
      void qc.invalidateQueries({ queryKey: ['billing-quotas'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : t('error')),
  });

  const enterpriseMut = useMutation({
    mutationFn: () => requestEnterprise(enterpriseMessage || undefined),
    onSuccess: () => setEnterpriseSent(true),
    onError: (e) => setActionError(e instanceof Error ? e.message : t('error')),
  });

  const subscription = subscriptionQuery.data;
  const quotas = quotasQuery.data;
  const currentPlan = subscription?.plan.code;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-brand">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {actionError ? (
        <p className="text-sm text-red-600" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">{t('currentPlan')}</h2>
            <p className="text-2xl font-semibold">
              {subscription?.plan.name ?? '—'}
            </p>
          </div>
          <span
            className={`rounded px-3 py-1 text-sm font-medium ${
              subscription?.status === 'ACTIVE'
                ? 'bg-green-100 text-green-800'
                : subscription?.status === 'READ_ONLY'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {subscription ? t(`status.${subscription.status}`) : '…'}
          </span>
        </div>
        {subscription?.accessMode === 'READ_ONLY' ? (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">
            {t('readOnlyWarning')}
          </p>
        ) : null}
        {subscription?.graceEndsAt ? (
          <p className="text-sm text-muted-foreground">
            {t('graceEndsAt', {
              date: new Date(subscription.graceEndsAt).toLocaleString(),
            })}
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <h2 className="text-lg font-medium">{t('usage')}</h2>
        {quotas ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <QuotaBar label={t('documents')} used={quotas.documents.used} limit={quotas.documents.limit} />
            <QuotaBar label={t('branches')} used={quotas.branches.used} limit={quotas.branches.limit} />
            <QuotaBar label={t('devices')} used={quotas.devices.used} limit={quotas.devices.limit} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('plans')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(plansQuery.data?.plans ?? []).map((plan) => {
            const isCurrent = plan.code === currentPlan;
            return (
              <div
                key={plan.code}
                className={`flex flex-col justify-between rounded border p-4 ${
                  isCurrent ? 'border-brand ring-1 ring-brand' : 'border-border'
                }`}
              >
                <div>
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('planQuotas', {
                      documents: plan.documentQuota,
                      branches: plan.branchQuota,
                      devices: plan.deviceQuota,
                    })}
                  </p>
                </div>
                <div className="mt-4">
                  {isCurrent ? (
                    <span className="text-sm font-medium text-brand">{t('current')}</span>
                  ) : plan.code === 'ENTERPRISE' ? (
                    <span className="text-sm text-muted-foreground">{t('contactSales')}</span>
                  ) : plan.code === 'FREE' ? (
                    <button
                      type="button"
                      className="w-full rounded border px-3 py-2 text-sm"
                      disabled={changePlanMut.isPending}
                      onClick={() => changePlanMut.mutate('FREE')}
                    >
                      {t('downgrade')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w-full rounded bg-brand px-3 py-2 text-sm text-white"
                      disabled={checkoutMut.isPending}
                      onClick={() => checkoutMut.mutate(plan.code as 'STARTER' | 'PRO')}
                    >
                      {t('upgradeTo', { plan: plan.name })}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <h2 className="text-lg font-medium">{t('enterpriseTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('enterpriseSubtitle')}</p>
        {enterpriseSent ? (
          <p className="text-sm text-green-700">{t('enterpriseSent')}</p>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <textarea
              className="min-w-[16rem] flex-1 rounded border px-2 py-1 text-sm"
              rows={2}
              placeholder={t('enterpriseMessagePlaceholder')}
              value={enterpriseMessage}
              onChange={(e) => setEnterpriseMessage(e.target.value)}
            />
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              disabled={enterpriseMut.isPending}
              onClick={() => enterpriseMut.mutate()}
            >
              {t('enterpriseContact')}
            </button>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <h2 className="text-lg font-medium">{t('invoices')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="p-2">{t('colDate')}</th>
                <th className="p-2">{t('colAmount')}</th>
                <th className="p-2">{t('colStatus')}</th>
                <th className="p-2">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {(invoicesQuery.data?.items ?? []).map((inv) => (
                <tr key={inv.id} className="border-b">
                  <td className="p-2">{new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td className="p-2">
                    {(inv.amountCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                  </td>
                  <td className="p-2">{inv.status}</td>
                  <td className="p-2">
                    {inv.hostedInvoiceUrl ? (
                      <a
                        className="text-brand underline"
                        href={inv.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('viewInvoice')}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!invoicesQuery.data?.items?.length ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={4}>
                    {t('noInvoices')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
