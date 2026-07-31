'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  acceptPurchase,
  declinePurchaseCancelation,
  getPurchase,
  patchPurchase,
  rejectPurchase,
  type PurchaseDetail,
} from '@/lib/api/purchases';
import { apiBase } from '@/lib/api/client';
import { getAccessToken, getActiveTenantId } from '@/lib/session';

export default function PurchaseDetailPage() {
  const t = useTranslations('purchases');
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [doc, setDoc] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [recon, setRecon] = useState('PENDING_REVIEW');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    getPurchase(id)
      .then((d) => {
        setDoc(d);
        setRecon(d.reconciliationStatus);
        setNote(d.reconciliationNote ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      const tenantId = getActiveTenantId();
      const res = await fetch(`${apiBase()}/purchases/${id}/printout`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
          Accept: 'application/pdf',
        },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `purchase-${doc?.documentUuid ?? id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!doc) {
    return (
      <div className="space-y-token-md">
        <Link href={`/${locale}/purchases`} className="text-brand text-token-sm">
          ← {t('back')}
        </Link>
        {error ? <p className="text-danger text-token-sm">{error}</p> : null}
        <p className="text-foreground/70">{t('loading')}</p>
      </div>
    );
  }

  const terminal = ['ACCEPTED', 'REJECTED', 'DECLINED_CANCELATION'].includes(
    doc.buyerDecision,
  );

  return (
    <div className="space-y-token-lg">
      <Link href={`/${locale}/purchases`} className="text-brand text-token-sm">
        ← {t('back')}
      </Link>
      <h1 className="font-display text-token-2xl text-brand">
        {doc.issuerName ?? doc.documentUuid}
      </h1>
      <dl className="grid grid-cols-1 gap-token-sm text-token-sm sm:grid-cols-2">
        <div>
          <dt className="text-foreground/60">{t('kind')}</dt>
          <dd>{doc.kind}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('uuid')}</dt>
          <dd className="break-all">{doc.documentUuid}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('internalId')}</dt>
          <dd>{doc.internalId ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('issued')}</dt>
          <dd>{doc.dateTimeIssued ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('total')}</dt>
          <dd>
            {doc.totalAmount ?? '—'} {doc.currency ?? ''}
          </dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('decision')}</dt>
          <dd>
            {doc.buyerDecision}
            {doc.buyerDecisionReason ? ` — ${doc.buyerDecisionReason}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('etaStatus')}</dt>
          <dd>{doc.etaStatus ?? '—'}</dd>
        </div>
        {doc.needsAttention ? (
          <div className="sm:col-span-2 text-danger">
            {doc.needsAttentionReason ?? t('needsAttention')}
          </div>
        ) : null}
      </dl>

      {error ? <p className="text-danger text-token-sm">{error}</p> : null}

      <div className="flex flex-wrap gap-token-sm">
        <button
          type="button"
          disabled={busy || terminal}
          className="rounded border border-border px-token-md py-token-sm text-token-sm disabled:opacity-50"
          onClick={() => void run(() => acceptPurchase(id))}
        >
          {t('accept')}
        </button>
        <button
          type="button"
          disabled={busy || terminal || !reason.trim()}
          className="rounded border border-border px-token-md py-token-sm text-token-sm disabled:opacity-50"
          onClick={() => void run(() => rejectPurchase(id, reason))}
        >
          {t('reject')}
        </button>
        <button
          type="button"
          disabled={busy || terminal}
          className="rounded border border-border px-token-md py-token-sm text-token-sm disabled:opacity-50"
          onClick={() => void run(() => declinePurchaseCancelation(id))}
        >
          {t('declineCancelation')}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
          onClick={() => void downloadPdf()}
        >
          {t('downloadPdf')}
        </button>
      </div>

      <label className="block text-token-sm">
        {t('rejectReason')}
        <input
          className="mt-1 w-full border border-border bg-background px-2 py-1"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={terminal}
        />
      </label>

      <div className="space-y-token-sm border-t border-border pt-token-md">
        <h2 className="font-display text-token-lg">{t('reconciliation')}</h2>
        <label className="block text-token-sm">
          {t('filterReconciliation')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={recon}
            onChange={(e) => setRecon(e.target.value)}
          >
            <option value="PENDING_REVIEW">PENDING_REVIEW</option>
            <option value="RECONCILED">RECONCILED</option>
            <option value="DISPUTED">DISPUTED</option>
          </select>
        </label>
        <label className="block text-token-sm">
          {t('reconNote')}
          <input
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-border px-token-md py-token-sm text-token-sm"
          onClick={() =>
            void run(() =>
              patchPurchase(id, {
                reconciliationStatus: recon,
                reconciliationNote: note || null,
              }),
            )
          }
        >
          {t('saveReconciliation')}
        </button>
      </div>

      <div>
        <h2 className="font-display text-token-lg">{t('lines')}</h2>
        {(doc.lines ?? []).length === 0 ? (
          <p className="text-foreground/70 text-token-sm">{t('noLines')}</p>
        ) : (
          <ul className="divide-y divide-border border border-border text-token-sm">
            {(doc.lines ?? []).map((line, i) => (
              <li key={i} className="px-token-md py-token-sm">
                {String(line.description ?? line.itemCode ?? `Line ${i + 1}`)} —{' '}
                {String(line.total ?? line.netTotal ?? '')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
