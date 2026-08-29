'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  fetchInvoices,
  fetchPlans,
  fetchQuotas,
  fetchSubscription,
} from '@/lib/api/billing';
import { formatQuantityDisplay } from '@/lib/format-number';
import {
  WhatsAppUpgradeDialog,
  type BillingInterest,
} from '@/components/billing/whatsapp-upgrade-dialog';

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
        <span className="tabular-nums text-muted-foreground" dir="ltr">
          {formatQuantityDisplay(used)} / {formatQuantityDisplay(limit)}
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
  const locale = useLocale();
  const [interest, setInterest] = useState<BillingInterest | null>(null);

  const plansQuery = useQuery({ queryKey: ['billing-plans'], queryFn: fetchPlans });
  const subscriptionQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: fetchSubscription,
  });
  const quotasQuery = useQuery({ queryKey: ['billing-quotas'], queryFn: fetchQuotas });
  const invoicesQuery = useQuery({ queryKey: ['billing-invoices'], queryFn: fetchInvoices });

  const subscription = subscriptionQuery.data;
  const quotas = quotasQuery.data;
  const currentPlan = subscription?.plan.code;

  const planLabel = (plan: { code: string; name: string; nameAr: string }) =>
    locale === 'ar' && plan.nameAr ? plan.nameAr : plan.name;

  const openForPlan = (plan: { code: string; name: string; nameAr: string }) => {
    setInterest({ planCode: plan.code, planLabel: planLabel(plan) });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-brand">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">{t('currentPlan')}</h2>
            <p className="text-2xl font-semibold">{subscription?.plan.name ?? '—'}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {t('pointsBalance')}:{' '}
            <span className="font-medium tabular-nums" dir="ltr">
              {subscription?.pointsBalance ?? 0}
            </span>
          </p>
          <button
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={() =>
              setInterest({ planCode: 'POINTS', planLabel: t('pointsTopUp') })
            }
          >
            {t('buyPoints')}
          </button>
        </div>
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
                  <h3 className="text-lg font-semibold">{planLabel(plan)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('planQuotas', {
                      documents: plan.documentQuota,
                      branches: plan.branchQuota,
                      devices: plan.deviceQuota,
                      points: plan.includedPoints,
                    })}
                  </p>
                </div>
                <div className="mt-4">
                  {isCurrent ? (
                    <span className="text-sm font-medium text-brand">{t('current')}</span>
                  ) : (
                    <button
                      type="button"
                      className={`w-full rounded px-3 py-2 text-sm ${
                        plan.code === 'FREE'
                          ? 'border'
                          : 'bg-brand text-white'
                      }`}
                      onClick={() => openForPlan(plan)}
                    >
                      {plan.code === 'ENTERPRISE'
                        ? t('contactSales')
                        : plan.code === 'FREE'
                          ? t('downgrade')
                          : t('upgradeTo', { plan: planLabel(plan) })}
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
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() =>
            setInterest({
              planCode: 'ENTERPRISE',
              planLabel:
                locale === 'ar'
                  ? (plansQuery.data?.plans.find((p) => p.code === 'ENTERPRISE')?.nameAr ??
                    t('enterpriseTitle'))
                  : (plansQuery.data?.plans.find((p) => p.code === 'ENTERPRISE')?.name ??
                    t('enterpriseTitle')),
            })
          }
        >
          {t('enterpriseContact')}
        </button>
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

      <WhatsAppUpgradeDialog
        open={interest !== null}
        interest={interest}
        onClose={() => setInterest(null)}
      />
    </div>
  );
}
