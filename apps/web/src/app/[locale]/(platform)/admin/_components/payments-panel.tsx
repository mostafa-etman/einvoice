'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addPayment,
  getPaymentAccount,
  listPayments,
  updatePaymentBilling,
  type AccountPaymentSummary,
  type ManualBillingStatus,
  type PaymentPurpose,
} from '@/lib/api/platform-admin';
import { formatDateDisplay, formatDateTimeDisplay } from '@/lib/format-date';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Table, type TableColumn } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

function statusVariant(status: ManualBillingStatus): BadgeVariant {
  if (status === 'PAID') return 'success';
  if (status === 'OVERDUE') return 'danger';
  if (status === 'DUE_SOON' || status === 'UNPAID') return 'warning';
  return 'info';
}

function egp(value: number) {
  return (
    <span className="font-en tabular-nums" dir="ltr">
      {value} EGP
    </span>
  );
}

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function fromDateInput(value: string): string | null {
  return value ? `${value}T00:00:00.000Z` : null;
}

export function PaymentsPanel() {
  const t = useTranslations('admin');
  const tPay = useTranslations('admin.payStatus');
  const locale = useLocale();
  const toast = useMutationToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [q]);

  const listQuery = useQuery({
    queryKey: ['platform-admin-payments', qDebounced, status],
    queryFn: () => listPayments({ q: qDebounced || undefined, status }),
  });

  const items = listQuery.data?.items ?? [];
  const summary = listQuery.data?.summary;

  const columns: TableColumn<AccountPaymentSummary>[] = [
    {
      id: 'account',
      header: t('colAccount'),
      cell: (row) => (
        <div>
          <div>{row.companies.map((c) => c.name).join(' · ') || row.accountId}</div>
          <div className="font-en text-token-xs text-foreground-muted" dir="ltr">
            {row.ownerEmail ?? '—'}
          </div>
        </div>
      ),
    },
    {
      id: 'plan',
      header: t('colPlan'),
      ltr: true,
      cell: (row) => row.planCode ?? '—',
    },
    {
      id: 'due',
      header: t('colAmountDue'),
      align: 'end',
      cell: (row) => egp(row.amountDueEgp),
    },
    {
      id: 'paid',
      header: t('colAmountPaid'),
      align: 'end',
      cell: (row) => egp(row.amountPaidEgp),
    },
    {
      id: 'out',
      header: t('colOutstanding'),
      align: 'end',
      cell: (row) => egp(row.outstandingEgp),
    },
    {
      id: 'last',
      header: t('colLastPayment'),
      ltr: true,
      cell: (row) => formatDateDisplay(row.lastPaymentAt, locale),
    },
    {
      id: 'next',
      header: t('colNextDue'),
      ltr: true,
      cell: (row) => formatDateDisplay(row.dueDate, locale),
    },
    {
      id: 'status',
      header: t('colStatus'),
      cell: (row) => <Badge variant={statusVariant(row.status)}>{tPay(row.status)}</Badge>,
    },
  ];

  return (
    <div className="space-y-token-md">
      <div className="grid gap-token-md sm:grid-cols-3">
        <StatCard
          label={t('totalCollected')}
          value={`${summary?.totalCollectedEgp ?? 0} EGP`}
          tone="teal"
        />
        <StatCard
          label={t('totalOutstanding')}
          value={`${summary?.totalOutstandingEgp ?? 0} EGP`}
          tone="warning"
        />
        <StatCard
          label={t('overdueCount')}
          value={String(summary?.overdueCount ?? 0)}
          tone="danger"
        />
      </div>
      <FilterBar>
        <Input
          label={t('searchPayments')}
          placeholder={t('searchPaymentsPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select label={t('filterPaymentStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t('allStatuses')}</option>
          <option value="unpaid">{t('filterUnpaid')}</option>
          <option value="overdue">{tPay('OVERDUE')}</option>
          <option value="DUE_SOON">{tPay('DUE_SOON')}</option>
          <option value="PARTIALLY_PAID">{tPay('PARTIALLY_PAID')}</option>
          <option value="UNPAID">{tPay('UNPAID')}</option>
          <option value="PAID">{tPay('PAID')}</option>
        </Select>
      </FilterBar>
      <Table
        caption={t('tabPayments')}
        columns={columns}
        rows={items}
        getRowId={(row) => row.accountId}
        loading={listQuery.isLoading}
        onRowClick={(row) => setSelectedId(row.accountId)}
        empty={<EmptyState title={t('paymentsEmpty')} />}
      />
      {selectedId ? (
        <AccountPaymentsDrawer
          accountId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['platform-admin-payments'] });
            void qc.invalidateQueries({ queryKey: ['platform-admin-payment-account'] });
            toast.saved();
          }}
          onError={(err) => toast.error(err)}
        />
      ) : null}
    </div>
  );
}

function AccountPaymentsDrawer({
  accountId,
  onClose,
  onChanged,
  onError,
}: {
  accountId: string;
  onClose: () => void;
  onChanged: () => void;
  onError: (err: unknown) => void;
}) {
  const t = useTranslations('admin');
  const tPay = useTranslations('admin.payStatus');
  const tPurpose = useTranslations('admin.payPurpose');
  const locale = useLocale();
  const detailQuery = useQuery({
    queryKey: ['platform-admin-payment-account', accountId],
    queryFn: () => getPaymentAccount(accountId),
  });
  const account = detailQuery.data;
  const [amountDue, setAmountDue] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState<PaymentPurpose>('PLAN');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!account) return;
    setAmountDue(String(account.amountDueEgp));
    setDueDate(toDateInput(account.dueDate));
  }, [account]);

  const billingMut = useMutation({
    mutationFn: () =>
      updatePaymentBilling(accountId, {
        amountDueEgp: Number(amountDue),
        dueDate: fromDateInput(dueDate),
      }),
    onSuccess: onChanged,
    onError,
  });
  const payMut = useMutation({
    mutationFn: () =>
      addPayment(accountId, {
        amountEgp: Number(payAmount),
        paidAt: fromDateInput(payDate) ?? undefined,
        purpose,
        method: method || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      setPayAmount('');
      setMethod('');
      setReference('');
      setNotes('');
      onChanged();
    },
    onError,
  });

  return (
    <Drawer open onClose={onClose} title={t('paymentAccountTitle')} side="end">
      {account ? (
        <div className="space-y-token-lg">
          <p className="m-0 text-token-sm">
            {account.companies.map((c) => c.name).join(' · ')}
            {account.ownerEmail ? (
              <>
                {' · '}
                <span className="font-en" dir="ltr">
                  {account.ownerEmail}
                </span>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-token-sm text-token-sm">
            <Badge variant={statusVariant(account.status)}>{tPay(account.status)}</Badge>
            <span>
              {t('colPlan')}:{' '}
              <span className="font-en" dir="ltr">
                {account.planCode ?? '—'}
              </span>
            </span>
            <span>
              {t('planPrice')}: {egp(account.planPriceEgp)}
            </span>
          </div>
          <p className="m-0 text-token-xs text-foreground-muted">{t('paymentsManualHint')}</p>

          <Card>
            <CardTitle>{t('setAmountDue')}</CardTitle>
            <form
              className="mt-token-md grid gap-token-md sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                billingMut.mutate();
              }}
            >
              <Input
                label={t('colAmountDue')}
                type="number"
                min={0}
                step={1}
                dir="ltr"
                value={amountDue}
                onChange={(e) => setAmountDue(e.target.value)}
              />
              <Input
                label={t('colNextDue')}
                type="date"
                dir="ltr"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <div className="sm:col-span-2">
                <Button type="submit" loading={billingMut.isPending}>
                  {t('saveBilling')}
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardTitle>{t('addPayment')}</CardTitle>
            <form
              className="mt-token-md grid gap-token-md sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                payMut.mutate();
              }}
            >
              <Input
                label={t('paymentAmount')}
                type="number"
                min={1}
                step={1}
                required
                dir="ltr"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <Input
                label={t('paymentDate')}
                type="date"
                required
                dir="ltr"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
              <Select
                label={t('paymentPurpose')}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as PaymentPurpose)}
              >
                <option value="PLAN">{tPurpose('PLAN')}</option>
                <option value="RENEWAL">{tPurpose('RENEWAL')}</option>
                <option value="POINTS_TOPUP">{tPurpose('POINTS_TOPUP')}</option>
                <option value="ADDON">{tPurpose('ADDON')}</option>
                <option value="OTHER">{tPurpose('OTHER')}</option>
              </Select>
              <Input
                label={t('paymentMethod')}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              />
              <Input
                label={t('paymentReference')}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <div className="sm:col-span-2">
                <Textarea
                  label={t('paymentNotes')}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={payMut.isPending} disabled={!payAmount}>
                  {t('recordPayment')}
                </Button>
              </div>
            </form>
          </Card>

          <div>
            <h3 className="mt-0 text-token-sm font-semibold">{t('paymentHistory')}</h3>
            {account.payments.length === 0 ? (
              <EmptyState title={t('noPaymentsYet')} />
            ) : (
              <ul className="m-0 list-none space-y-token-sm p-0">
                {account.payments.map((p) => (
                  <li key={p.id} className="rounded-md border border-border px-token-md py-token-sm">
                    <div className="flex flex-wrap justify-between gap-token-sm">
                      {egp(p.amountEgp)}
                      <span className="font-en text-token-xs text-foreground-muted" dir="ltr">
                        {formatDateTimeDisplay(p.paidAt, locale)}
                      </span>
                    </div>
                    <div className="mt-token-2xs text-token-xs text-foreground-muted">
                      {tPurpose(p.purpose)}
                      {p.method ? ` · ${p.method}` : ''}
                      {p.reference ? (
                        <>
                          {' · '}
                          <span className="font-en" dir="ltr">
                            {p.reference}
                          </span>
                        </>
                      ) : null}
                    </div>
                    {p.notes ? <p className="mb-0 mt-token-2xs text-token-sm">{p.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="text-token-sm text-foreground-muted">{t('loading')}</p>
      )}
    </Drawer>
  );
}
