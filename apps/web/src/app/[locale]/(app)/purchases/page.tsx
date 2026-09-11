'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  latestPurchaseSync,
  listPurchases,
  resetPurchaseSync,
  syncPurchases,
  type PurchaseSummary,
  type SyncRun,
} from '@/lib/api/purchases';
import { formatMoneyDisplay } from '@/lib/format-number';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyButton } from '@/components/ui/copy-button';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { PurchaseStatusBadge } from './_components/purchase-status-badge';
import {
  ETA_STATUS_FILTERS,
  KIND_FILTERS,
  PAGE_SIZE,
  formatIssueDate,
  isAlreadyRunningError,
  isSyncBusy,
  type SortBy,
} from './_components/purchase-list-utils';

export default function PurchasesPage() {
  const t = useTranslations('purchases');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { push } = useToast();
  const [items, setItems] = useState<PurchaseSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listReady, setListReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kind, setKind] = useState('');
  const [etaStatus, setEtaStatus] = useState('');
  const [seller, setSeller] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [syncFrom, setSyncFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [syncTo, setSyncTo] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sortBy, setSortBy] = useState<SortBy>('dateTimeIssued');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showStuckReset, setShowStuckReset] = useState(false);

  const queryParams = useCallback(
    (cursor?: string) => ({
      kind: kind || undefined,
      etaStatus: etaStatus || undefined,
      from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
      seller: seller.trim() || undefined,
      q: q.trim() || undefined,
      sortBy,
      sortDir,
      limit: PAGE_SIZE,
      cursor,
    }),
    [kind, etaStatus, from, to, q, seller, sortBy, sortDir],
  );

  const reload = useCallback(() => {
    listPurchases(queryParams())
      .then((res) => {
        setItems(res.items);
        setNextCursor(res.nextCursor);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setListReady(true));
    latestPurchaseSync()
      .then((run) => {
        setSync(run);
        setShowStuckReset(isSyncBusy(run.status));
      })
      .catch(() => undefined);
  }, [queryParams]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listPurchases(queryParams(nextCursor));
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await syncPurchases({
        from: syncFrom ? `${syncFrom}T00:00:00.000Z` : undefined,
        to: syncTo ? `${syncTo}T23:59:59.999Z` : undefined,
      });
      setSync(run);
      setShowStuckReset(true);
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const latest = await latestPurchaseSync();
        setSync(latest);
        if (latest.status === 'SUCCEEDED' || latest.status === 'FAILED') {
          setShowStuckReset(false);
          break;
        }
      }
      reload();
      push({ title: t('syncNow'), kind: 'success', timeoutMs: 12000 });
    } catch (e) {
      if (isAlreadyRunningError(e)) {
        setShowStuckReset(true);
        setError(t('syncAlreadyRunning'));
        push({ title: t('syncAlreadyRunning'), kind: 'error', timeoutMs: 12000 });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        push({ title: msg, kind: 'error', timeoutMs: 12000 });
      }
    } finally {
      setBusy(false);
    }
  };

  const onResetSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await resetPurchaseSync();
      setSync(res.latest);
      setShowStuckReset(false);
      push({ title: t('syncResetOk'), kind: 'success', timeoutMs: 12000 });
    } catch (e) {
      const msg = t('syncResetFailed', {
        message: e instanceof Error ? e.message : String(e),
      });
      setError(msg);
      push({ title: msg, kind: 'error', timeoutMs: 12000 });
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'dateTimeIssued' || col === 'totalAmount' ? 'desc' : 'asc');
    }
  };

  const kindLabel = (k: string) => {
    if (k === 'PURCHASE_INVOICE') return t('kindInvoice');
    if (k === 'PURCHASE_RETURN') return t('kindReturn');
    return t('kindOther');
  };

  const sortIndicator = (col: SortBy) => {
    if (sortBy !== col) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const statusLabel = (row: PurchaseSummary) => {
    const status = String(row.etaStatus ?? '').toLowerCase();
    if (status === 'valid') return t('etaStatusValid');
    if (status === 'invalid') return t('etaStatusInvalid');
    if (status === 'rejected') return t('etaStatusRejected');
    if (status === 'cancelled') return t('etaStatusCancelled');
    if (status === 'submitted') return t('etaStatusSubmitted');
    return row.etaStatus || row.buyerDecision || '—';
  };

  const filtersActive = Boolean(
    kind || etaStatus || from || to || seller.trim() || q.trim(),
  );

  const resetFilters = () => {
    setKind('');
    setEtaStatus('');
    setFrom('');
    setTo('');
    setSeller('');
    setQ('');
  };

  return (
    <div className="space-y-token-lg" data-testid="purchases-page">
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
        subtitle={`${t('listLoaded', { count: items.length })} · ${t('syncRangeHint')}`}
        actions={
          <>
            <Input
              type="date"
              label={t('syncFrom')}
              value={syncFrom}
              onChange={(e) => setSyncFrom(e.target.value)}
              dir="ltr"
              className="w-auto"
            />
            <Input
              type="date"
              label={t('syncTo')}
              value={syncTo}
              onChange={(e) => setSyncTo(e.target.value)}
              dir="ltr"
              className="w-auto"
            />
            {showStuckReset ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void onResetSync()}
              >
                {t('syncReset')}
              </Button>
            ) : null}
            <Button
              disabled={busy}
              loading={busy}
              onClick={() => void onSync()}
            >
              {busy ? t('syncing') : t('syncNow')}
            </Button>
          </>
        }
      />

      {sync?.status ? (
        <p
          className={
            sync.status === 'FAILED'
              ? 'rounded-lg border-2 border-danger bg-danger/10 px-token-md py-token-md text-token-sm font-medium text-danger'
              : sync.status === 'SUCCEEDED'
                ? 'rounded-lg border-2 border-success bg-success-muted px-token-md py-token-md text-token-sm font-medium text-foreground'
                : 'text-token-sm text-foreground-muted'
          }
          role="status"
        >
          {t('lastSync', {
            status: sync.status,
            newCount: String(sync.newCount ?? 0),
            updatedCount: String(sync.updatedCount ?? 0),
            skippedCount: String(sync.skippedCount ?? 0),
          })}
          {sync.errorSummary ? ` — ${sync.errorSummary}` : ''}
        </p>
      ) : null}

      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder={t('filterSearch')}
        onReset={resetFilters}
        chips={[
          {
            id: 'all',
            label: t('filterAll'),
            active: etaStatus === '',
            onClick: () => setEtaStatus(''),
          },
          ...ETA_STATUS_FILTERS.map((s) => ({
            id: s.value,
            label: t(s.labelKey),
            active: etaStatus === s.value,
            onClick: () => setEtaStatus(s.value),
          })),
        ]}
      >
        <Input
          type="date"
          label={t('filterFrom')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          dir="ltr"
          className="w-auto"
        />
        <Input
          type="date"
          label={t('filterTo')}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          dir="ltr"
          className="w-auto"
        />
        <Select
          label={t('filterKind')}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="w-auto"
        >
          <option value="">{t('filterAll')}</option>
          {KIND_FILTERS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </Select>
        <Input
          label={t('filterSeller')}
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          placeholder={t('filterSeller')}
          className="min-w-[var(--size-search-min)]"
        />
      </FilterBar>

      {error ? (
        <Card className="border-danger" data-testid="purchases-error" role="alert">
          <p className="m-0 text-token-sm font-medium text-danger">{error}</p>
          <Button className="mt-token-sm" size="sm" variant="secondary" onClick={() => reload()}>
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      {!listReady ? (
        <div data-testid="purchases-loading" className="space-y-token-sm" aria-busy="true">
          <Skeleton variant="rect" className="h-token-xl" />
          <Skeleton variant="rect" className="h-[12rem]" />
        </div>
      ) : items.length === 0 && !error ? (
        <div data-testid="purchases-empty">
          <EmptyState
            title={filtersActive ? t('emptyFiltered') : t('empty')}
            action={{
              label: filtersActive ? t('retryLoad') : t('syncNow'),
              onClick: () => {
                if (filtersActive) resetFilters();
                else void onSync();
              },
            }}
          />
        </div>
      ) : items.length === 0 ? null : (
        <TableWrap data-testid="purchases-table">
          <table className="w-full min-w-[72rem] border-collapse text-start text-token-sm">
            <caption className="sr-only">{t('listCaption')}</caption>
            <thead>
              <tr>
                <Th>
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('internalId')}>
                    {t('colInvoice')}
                    {sortIndicator('internalId')}
                  </button>
                </Th>
                <Th>{t('colEtaId')}</Th>
                <Th>{t('colType')}</Th>
                <Th>
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('dateTimeIssued')}>
                    {t('colIssueDate')}
                    {sortIndicator('dateTimeIssued')}
                  </button>
                </Th>
                <Th>
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('issuerName')}>
                    {t('colSeller')}
                    {sortIndicator('issuerName')}
                  </button>
                </Th>
                <Th>{t('colSellerTax')}</Th>
                <Th align="end">
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('totalAmount')}>
                    {t('colAmount')}
                    {sortIndicator('totalAmount')}
                  </button>
                </Th>
                <Th>{t('colCurrency')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th>{t('colSynced')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const etaId = row.etaLongId || row.documentUuid;
                return (
                  <tr key={row.id} className="hover:bg-surface-alt">
                    <Td>
                      <Link
                        href={`/${locale}/purchases/${row.id}`}
                        className="font-en font-medium text-brand hover:underline"
                        dir="ltr"
                      >
                        {row.internalId || '—'}
                      </Link>
                    </Td>
                    <Td className="max-w-[14rem]">
                      {etaId ? (
                        <span className="inline-flex max-w-full items-center gap-token-xs">
                          <span
                            className="block truncate font-en text-token-xs text-foreground-muted"
                            dir="ltr"
                            title={etaId}
                          >
                            {etaId}
                          </span>
                          <CopyButton value={etaId} className="shrink-0" />
                        </span>
                      ) : (
                        <span className="text-foreground-muted">—</span>
                      )}
                    </Td>
                    <Td>{kindLabel(row.kind)}</Td>
                    <Td>
                      <span dir="ltr" className="font-en tabular-nums">
                        {formatIssueDate(row.dateTimeIssued)}
                      </span>
                    </Td>
                    <Td className="font-medium">{row.issuerName || '—'}</Td>
                    <Td>
                      <span dir="ltr" className="font-en tabular-nums">
                        {row.issuerId || '—'}
                      </span>
                    </Td>
                    <Td align="end">
                      <span dir="ltr" className="font-en tabular-nums">
                        {formatMoneyDisplay(row.totalAmount)}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-en">
                        {row.currency || '—'}
                      </span>
                    </Td>
                    <Td>
                      <PurchaseStatusBadge status={row.etaStatus} label={statusLabel(row)} />
                    </Td>
                    <Td>
                      <Badge variant="warning">{t('syncedBadge')}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={loadingMore}
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
