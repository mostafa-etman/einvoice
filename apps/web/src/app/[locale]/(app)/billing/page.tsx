'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  fetchCatalog,
  fetchInvoices,
  fetchQuotas,
  fetchSubscription,
  type InvoiceRef,
  type SubscriptionStatus,
} from '@/lib/api/billing';
import { formatQuantityDisplay } from '@/lib/format-number';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import {
  WhatsAppUpgradeDialog,
  type BillingInterest,
} from '@/components/billing/whatsapp-upgrade-dialog';
import { AddonCards, PlanCards, PromoNote } from '@/components/billing/plan-cards';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, type TableColumn } from '@/components/ui/table';
import { cn } from '@/lib/cn';

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
    <div className="space-y-token-xs">
      <div className="flex items-center justify-between text-token-sm">
        <span>{label}</span>
        <span className="font-en tabular-nums text-foreground-muted" dir="ltr">
          {formatQuantityDisplay(used)} / {formatQuantityDisplay(limit)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="h-token-xs overflow-hidden rounded-pill bg-surface-alt"
      >
        <div
          className={cn('h-full rounded-pill', danger ? 'bg-danger' : 'bg-gradient-brand')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function statusVariant(status: SubscriptionStatus): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'TRIAL') return 'warning';
  if (status === 'PAST_DUE') return 'warning';
  if (status === 'READ_ONLY' || status === 'SUSPENDED' || status === 'CANCELLED') {
    return 'danger';
  }
  return 'neutral';
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const tNav = useTranslations('nav');
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

  const invoiceColumns: TableColumn<InvoiceRef>[] = [
    {
      id: 'date',
      header: t('colDate'),
      cell: (inv) => (
        <span className="font-en text-token-xs" dir="ltr">
          {new Date(inv.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'amount',
      header: t('colAmount'),
      cell: (inv) => (
        <span className="font-en tabular-nums" dir="ltr">
          {(inv.amountCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('colStatus'),
      cell: (inv) => (
        <span className="font-en" dir="ltr">
          {inv.status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('colActions'),
      align: 'end',
      cell: (inv) =>
        inv.hostedInvoiceUrl ? (
          <a
            className="text-brand underline"
            href={inv.hostedInvoiceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t('viewInvoice')}
          </a>
        ) : null,
    },
  ];

  const queryBusy =
    catalogQuery.isLoading ||
    subscriptionQuery.isLoading ||
    quotasQuery.isLoading ||
    invoicesQuery.isLoading;

  return (
    <div className="space-y-token-lg" aria-busy={queryBusy || undefined}>
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
        subtitle={t('subtitle')}
      />
      <CopyableTenantId id={tenantId} />

      {subscriptionQuery.isError ? (
        <Card className="border-danger" role="alert">
          <p className="m-0 text-token-sm text-danger">
            {subscriptionQuery.error instanceof Error
              ? subscriptionQuery.error.message
              : t('errorGeneric')}
          </p>
          <Button
            className="mt-token-sm"
            variant="secondary"
            size="sm"
            onClick={() => void subscriptionQuery.refetch()}
          >
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('currentPlan')}</CardTitle>
            {subscriptionQuery.isLoading ? (
              <Skeleton variant="rect" className="mt-token-sm h-token-lg w-1/3" />
            ) : (
              <p className="mt-token-xs text-token-xl font-semibold">
                {locale === 'ar' && subscription?.plan.nameAr
                  ? subscription.plan.nameAr
                  : (subscription?.plan.name ?? '—')}
              </p>
            )}
          </div>
          {subscription ? (
            <Badge variant={statusVariant(subscription.status)}>
              {t(`status.${subscription.status}`)}
            </Badge>
          ) : null}
        </CardHeader>
        {subscription?.accessMode === 'READ_ONLY' ? (
          <p className="rounded-md bg-danger-muted p-token-sm text-token-sm text-danger" role="alert">
            {t('readOnlyWarning')}
          </p>
        ) : null}
        {subscription?.trialEndsAt ? (
          <p className="text-token-sm text-foreground-muted">
            {t('trialEndsAt', {
              date: new Date(subscription.trialEndsAt).toLocaleString(),
            })}
          </p>
        ) : null}
        {subscription?.sendBlocked ? (
          <p className="rounded-md bg-danger-muted p-token-sm text-token-sm text-danger" role="alert">
            {t('sendBlockedMessage')}
          </p>
        ) : null}
        <div className="mt-token-md flex flex-wrap items-center justify-between gap-token-sm">
          <p className="m-0 text-token-sm">
            {t('pointsBalance')}:{' '}
            <span className="font-en font-medium tabular-nums" dir="ltr">
              {subscription?.pointsBalance ?? 0}
            </span>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setInterest({ kind: 'points', planCode: 'POINTS', planLabel: t('pointsTopUp') })
            }
          >
            {t('buyPoints')}
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-token-md">{t('usage')}</CardTitle>
        {quotasQuery.isLoading ? (
          <div className="grid gap-token-md sm:grid-cols-3">
            <Skeleton variant="rect" className="h-token-lg" />
            <Skeleton variant="rect" className="h-token-lg" />
            <Skeleton variant="rect" className="h-token-lg" />
          </div>
        ) : quotas ? (
          <div className="grid gap-token-md sm:grid-cols-3">
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
        ) : quotasQuery.isError ? (
          <p className="m-0 text-token-sm text-danger" role="alert">
            {quotasQuery.error instanceof Error ? quotasQuery.error.message : t('errorGeneric')}
          </p>
        ) : null}
      </Card>

      <section className="space-y-token-sm">
        <h2 className="m-0 text-token-lg font-semibold text-foreground">{t('plans')}</h2>
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

      <Card>
        <h2 className="m-0 text-token-lg font-semibold text-foreground">{t('addonsTitle')}</h2>
        <p className="mt-token-xs text-token-sm text-foreground-muted">{t('addonsSubtitle')}</p>
        <div className="mt-token-md">
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
        </div>
      </Card>

      <section>
        <h2 className="m-0 mb-token-md text-token-lg font-semibold text-foreground">
          {t('invoices')}
        </h2>
        {invoicesQuery.isError ? (
          <Card className="border-danger" role="alert">
            <p className="m-0 text-token-sm text-danger">
              {invoicesQuery.error instanceof Error
                ? invoicesQuery.error.message
                : t('errorGeneric')}
            </p>
            <Button
              className="mt-token-sm"
              variant="secondary"
              size="sm"
              onClick={() => void invoicesQuery.refetch()}
            >
              {t('retryLoad')}
            </Button>
          </Card>
        ) : (
          <Table
            caption={t('listCaption')}
            columns={invoiceColumns}
            rows={invoicesQuery.data?.items ?? []}
            getRowId={(inv) => inv.id}
            loading={invoicesQuery.isLoading}
            empty={<EmptyState title={t('noInvoices')} />}
          />
        )}
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
