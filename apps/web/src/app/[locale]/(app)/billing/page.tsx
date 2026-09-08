'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  fetchCatalog,
  fetchInvoices,
  fetchQuotas,
  fetchSubscription,
} from '@/lib/api/billing';
import { formatQuantityDisplay } from '@/lib/format-number';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import {
  WhatsAppUpgradeDialog,
  type BillingInterest,
} from '@/components/billing/whatsapp-upgrade-dialog';
import { AddonCards, PlanCards, PromoNote } from '@/components/billing/plan-cards';
import { useTenant } from '@/lib/tenant-provider';

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
  const { tenantId } = useTenant();
  const [interest, setInterest] = useState<BillingInterest | null>(null);

  const catalogQuery = useQuery({ queryKey: ['billing-catalog'], queryFn: fetchCatalog });
  const subscriptionQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: fetchSubscription,
  });
  const quotasQuery = useQuery({ queryKey: ['billing-quotas'], queryFn: fetchQuotas });
  const invoicesQuery = useQuery({ queryKey: ['billing-invoices'], queryFn: fetchInvoices });

  const subscription = subscriptionQuery.data;
  const quotas = quotasQuery.data;
  const currentPlan = subscription?.plan.code;
  const catalog = catalogQuery.data;

  const planLabel = (plan: { code: string; name: string; nameAr: string }) =>
    locale === 'ar' && plan.nameAr ? plan.nameAr : plan.name;

  const currentPlanView = (catalog?.plans ?? []).find((p) => p.code === currentPlan);
  const currentPlanLabel = currentPlanView
    ? planLabel(currentPlanView)
    : (subscription?.plan.nameAr && locale === 'ar'
        ? subscription.plan.nameAr
        : (subscription?.plan.name ?? null));

  const openForPlan = (plan: { code: string; name: string; nameAr: string }) => {
    setInterest({ kind: 'upgrade', planCode: plan.code, planLabel: planLabel(plan) });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-brand">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <CopyableTenantId id={tenantId} className="mt-2" />
      </header>

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">{t('currentPlan')}</h2>
            <p className="text-2xl font-semibold">
              {locale === 'ar' && subscription?.plan.nameAr
                ? subscription.plan.nameAr
                : (subscription?.plan.name ?? '—')}
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
        {subscription?.trialEndsAt ? (
          <p className="text-sm text-muted-foreground">
            {t('trialEndsAt', {
              date: new Date(subscription.trialEndsAt).toLocaleString(),
            })}
          </p>
        ) : null}
        {subscription?.sendBlocked ? (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700" role="alert">
            {t('sendBlockedMessage')}
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
              setInterest({ kind: 'points', planCode: 'POINTS', planLabel: t('pointsTopUp') })
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
            {quotas.users ? (
              <QuotaBar label={t('users')} used={quotas.users.used} limit={quotas.users.limit} />
            ) : null}
            {quotas.companies ? (
              <QuotaBar label={t('companies')} used={quotas.companies.used} limit={quotas.companies.limit} />
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('plans')}</h2>
        {catalog ? <PromoNote catalog={catalog} /> : null}
        <PlanCards
          plans={(catalog?.plans ?? []).filter(
            (p) => !p.isTrial || p.code === currentPlan,
          )}
          currentPlanCode={currentPlan}
          onChoose={openForPlan}
          trialDays={catalog?.trialDays}
        />
      </section>

      <section className="space-y-3 rounded border border-border bg-background p-4">
        <h2 className="text-lg font-medium">{t('addonsTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('addonsSubtitle')}</p>
        <AddonCards
          addons={catalog?.addons ?? []}
          onChoose={(addon) =>
            setInterest({
              kind: 'addon',
              planCode: addon.code,
              planLabel: locale === 'ar' && addon.nameAr ? addon.nameAr : addon.name,
            })
          }
        />
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
        currentPlanLabel={currentPlanLabel}
        onClose={() => setInterest(null)}
      />
    </div>
  );
}
