'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  latestPurchaseSync,
  listPurchases,
  syncPurchases,
  type PurchaseSummary,
  type SyncRun,
} from '@/lib/api/purchases';

export default function PurchasesPage() {
  const t = useTranslations('purchases');
  const locale = useLocale();
  const [items, setItems] = useState<PurchaseSummary[]>([]);
  const [sync, setSync] = useState<SyncRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('');
  const [buyerDecision, setBuyerDecision] = useState('');
  const [reconciliationStatus, setReconciliationStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const reload = useCallback(() => {
    listPurchases({
      kind: kind || undefined,
      buyerDecision: buyerDecision || undefined,
      reconciliationStatus: reconciliationStatus || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      q: q || undefined,
    })
      .then((res) => setItems(res.items))
      .catch((e: Error) => setError(e.message));
    latestPurchaseSync()
      .then(setSync)
      .catch(() => undefined);
  }, [kind, buyerDecision, reconciliationStatus, from, to, q]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await syncPurchases();
      setSync(run);
      // Poll briefly for completion
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const latest = await latestPurchaseSync();
        setSync(latest);
        if (latest.status === 'SUCCEEDED' || latest.status === 'FAILED') break;
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = (k: string) => {
    if (k === 'PURCHASE_INVOICE') return t('kindInvoice');
    if (k === 'PURCHASE_RETURN') return t('kindReturn');
    return t('kindOther');
  };

  return (
    <div className="space-y-token-lg">
      <div className="flex flex-wrap items-center justify-between gap-token-md">
        <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSync()}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
        >
          {busy ? t('syncing') : t('syncNow')}
        </button>
      </div>

      {sync?.status ? (
        <p className="text-token-sm text-foreground/70">
          {t('lastSync', {
            status: sync.status,
            newCount: String(sync.newCount ?? 0),
            updatedCount: String(sync.updatedCount ?? 0),
            skippedCount: String(sync.skippedCount ?? 0),
          })}
          {sync.errorSummary ? ` — ${sync.errorSummary}` : ''}
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
          {t('filterDecision')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={buyerDecision}
            onChange={(e) => setBuyerDecision(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
            <option value="NONE">NONE</option>
            <option value="ACCEPTED">ACCEPTED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="NEEDS_ATTENTION">NEEDS_ATTENTION</option>
          </select>
        </label>
        <label className="block text-token-xs">
          {t('filterReconciliation')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={reconciliationStatus}
            onChange={(e) => setReconciliationStatus(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
            <option value="PENDING_REVIEW">PENDING_REVIEW</option>
            <option value="RECONCILED">RECONCILED</option>
            <option value="DISPUTED">DISPUTED</option>
          </select>
        </label>
        <label className="block text-token-xs">
          {t('filterSearch')}
          <input
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="uuid / issuer"
          />
        </label>
      </div>

      {error ? <p className="text-token-sm text-danger">{error}</p> : null}
      {items.length === 0 ? (
        <p className="text-foreground/70">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {items.map((row) => (
            <li key={row.id} className="px-token-md py-token-sm">
              <Link
                href={`/${locale}/purchases/${row.id}`}
                className="flex flex-wrap items-baseline justify-between gap-token-sm"
              >
                <span>
                  <span className="font-medium text-brand">
                    {kindLabel(row.kind)}
                  </span>{' '}
                  {row.issuerName ?? row.documentUuid}
                </span>
                <span className="text-token-xs text-foreground/60">
                  {row.buyerDecision} · {row.totalAmount ?? '—'}{' '}
                  {row.currency ?? ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
