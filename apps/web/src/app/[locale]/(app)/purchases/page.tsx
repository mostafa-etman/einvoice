'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import {
  latestPurchaseSync,
  listPurchases,
  resetPurchaseSync,
  syncPurchases,
  type PurchaseSummary,
  type SyncRun,
} from '@/lib/api/purchases';
import { formatMoneyDisplay } from '@/lib/format-number';

type SortBy =
  | 'dateTimeIssued'
  | 'totalAmount'
  | 'internalId'
  | 'issuerName'
  | 'lastSyncedAt';

const PAGE_SIZE = 50;

function formatIssueDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSyncBusy(status: string | null | undefined) {
  return status === 'PENDING' || status === 'RUNNING';
}

function isAlreadyRunningError(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 409) return false;
  const msg = e.message.toLowerCase();
  return msg.includes('already running') || msg.includes('in progress');
}

export default function PurchasesPage() {
  const t = useTranslations('purchases');
  const locale = useLocale();
  const [items, setItems] = useState<PurchaseSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      .catch((e: Error) => setError(e.message));
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
    setToast(null);
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
    } catch (e) {
      if (isAlreadyRunningError(e)) {
        setShowStuckReset(true);
        setError(t('syncAlreadyRunning'));
      } else {
        setError(e instanceof Error ? e.message : String(e));
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
      setToast(t('syncResetOk'));
    } catch (e) {
      setError(
        t('syncResetFailed', {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
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

  const thClass =
    'whitespace-nowrap border-b border-border px-token-sm py-token-sm text-start text-token-xs font-medium text-foreground/70';
  const tdClass = 'border-b border-border px-token-sm py-token-sm text-token-sm';

  return (
    <div className="space-y-token-lg">
      <div className="flex flex-wrap items-center justify-between gap-token-md">
        <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
        <div className="flex flex-wrap items-end gap-token-sm">
          <label className="block text-token-xs">
            {t('syncFrom')}
            <input
              type="date"
              className="mt-1 block border border-border bg-background px-2 py-1"
              value={syncFrom}
              onChange={(e) => setSyncFrom(e.target.value)}
              dir="ltr"
            />
          </label>
          <label className="block text-token-xs">
            {t('syncTo')}
            <input
              type="date"
              className="mt-1 block border border-border bg-background px-2 py-1"
              value={syncTo}
              onChange={(e) => setSyncTo(e.target.value)}
              dir="ltr"
            />
          </label>
          {showStuckReset ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onResetSync()}
              className="rounded border border-danger/50 px-token-md py-token-sm text-token-sm text-danger disabled:opacity-50"
            >
              {t('syncReset')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSync()}
            className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
          >
            {busy ? t('syncing') : t('syncNow')}
          </button>
        </div>
      </div>
      <p className="text-token-xs text-foreground/60">{t('syncRangeHint')}</p>

      {sync?.status ? (
        <p
          className={
            sync.status === 'FAILED'
              ? 'rounded border-2 border-danger bg-danger/10 px-token-md py-token-md text-token-sm font-medium text-danger'
              : sync.status === 'SUCCEEDED'
                ? 'rounded border-2 border-green-600 bg-green-50 px-token-md py-token-md text-token-sm font-medium text-green-900'
                : 'text-token-sm text-foreground/70'
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

      {toast ? (
        <p
          className="rounded border-2 border-green-600 bg-green-50 px-token-md py-token-md text-token-sm font-medium text-green-900"
          role="status"
        >
          {toast}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-token-sm md:grid-cols-3 lg:grid-cols-6">
        <label className="block text-token-xs">
          {t('filterFrom')}
          <input
            type="date"
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block text-token-xs">
          {t('filterTo')}
          <input
            type="date"
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="block text-token-xs">
          {t('filterKind')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
            <option value="PURCHASE_INVOICE">{t('kindInvoice')}</option>
            <option value="PURCHASE_RETURN">{t('kindReturn')}</option>
            <option value="OTHER_RECEIVED">{t('kindOther')}</option>
          </select>
        </label>
        <label className="block text-token-xs">
          {t('filterStatus')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={etaStatus}
            onChange={(e) => setEtaStatus(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
            {[
              { value: 'Valid', label: t('etaStatusValid') },
              { value: 'Invalid', label: t('etaStatusInvalid') },
              { value: 'Rejected', label: t('etaStatusRejected') },
              { value: 'Cancelled', label: t('etaStatusCancelled') },
              { value: 'Submitted', label: t('etaStatusSubmitted') },
            ].map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-token-xs">
          {t('filterSeller')}
          <input
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            placeholder={t('filterSeller')}
          />
        </label>
        <label className="block text-token-xs">
          {t('filterSearch')}
          <input
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('filterSearch')}
          />
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded border-2 border-danger bg-danger/10 px-token-md py-token-md text-token-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-foreground/70">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="min-w-full border-collapse text-start">
            <thead className="bg-background/80">
              <tr>
                <th className={thClass}>
                  <button
                    type="button"
                    className="hover:text-brand"
                    onClick={() => toggleSort('internalId')}
                    aria-label={
                      sortDir === 'asc' ? t('sortAsc') : t('sortDesc')
                    }
                  >
                    {t('colInvoice')}
                    {sortIndicator('internalId')}
                  </button>
                </th>
                <th className={thClass}>{t('colEtaId')}</th>
                <th className={thClass}>{t('colType')}</th>
                <th className={thClass}>
                  <button
                    type="button"
                    className="hover:text-brand"
                    onClick={() => toggleSort('dateTimeIssued')}
                  >
                    {t('colIssueDate')}
                    {sortIndicator('dateTimeIssued')}
                  </button>
                </th>
                <th className={thClass}>
                  <button
                    type="button"
                    className="hover:text-brand"
                    onClick={() => toggleSort('issuerName')}
                  >
                    {t('colSeller')}
                    {sortIndicator('issuerName')}
                  </button>
                </th>
                <th className={thClass}>{t('colSellerTax')}</th>
                <th className={thClass}>
                  <button
                    type="button"
                    className="hover:text-brand"
                    onClick={() => toggleSort('totalAmount')}
                  >
                    {t('colAmount')}
                    {sortIndicator('totalAmount')}
                  </button>
                </th>
                <th className={thClass}>{t('colCurrency')}</th>
                <th className={thClass}>{t('colStatus')}</th>
                <th className={thClass}>{t('colSynced')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-brand/5">
                  <td className={tdClass}>
                    <Link
                      href={`/${locale}/purchases/${row.id}`}
                      className="font-medium text-brand hover:underline"
                      dir="ltr"
                    >
                      {row.internalId || '—'}
                    </Link>
                  </td>
                  <td className={`${tdClass} max-w-[14rem]`}>
                    <span
                      className="block truncate font-mono text-token-xs"
                      dir="ltr"
                      title={row.etaLongId || row.documentUuid}
                    >
                      {row.etaLongId || row.documentUuid}
                    </span>
                  </td>
                  <td className={tdClass}>{kindLabel(row.kind)}</td>
                  <td className={tdClass}>
                    <span dir="ltr" className="tabular-nums">
                      {formatIssueDate(row.dateTimeIssued)}
                    </span>
                  </td>
                  <td className={tdClass}>{row.issuerName || '—'}</td>
                  <td className={tdClass}>
                    <span dir="ltr" className="tabular-nums">
                      {row.issuerId || '—'}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span dir="ltr" className="tabular-nums">
                      {formatMoneyDisplay(row.totalAmount)}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span dir="ltr">{row.currency || '—'}</span>
                  </td>
                  <td className={tdClass}>
                    {(() => {
                      const status = String(row.etaStatus ?? '').toLowerCase();
                      const label =
                        status === 'valid'
                          ? t('etaStatusValid')
                          : status === 'invalid'
                            ? t('etaStatusInvalid')
                            : status === 'rejected'
                              ? t('etaStatusRejected')
                              : status === 'cancelled'
                                ? t('etaStatusCancelled')
                                : status === 'submitted'
                                  ? t('etaStatusSubmitted')
                                  : row.etaStatus || row.buyerDecision || '—';
                      return <span>{label}</span>;
                    })()}
                  </td>
                  <td className={tdClass}>
                    <span className="rounded bg-amber-100 px-token-xs text-token-xs text-amber-900">
                      {t('syncedBadge')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="rounded border border-border px-token-md py-token-sm text-token-sm disabled:opacity-50"
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
