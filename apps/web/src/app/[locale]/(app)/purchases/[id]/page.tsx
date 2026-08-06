'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  acceptPurchase,
  declinePurchaseCancelation,
  downloadPurchaseLocalPrintout,
  downloadPurchasePrintout,
  getPurchase,
  patchPurchase,
  rejectPurchase,
  type PurchaseDetail,
  type PurchaseLine,
} from '@/lib/api/purchases';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function partyField(party: unknown, ...keys: string[]): string {
  const obj = asRecord(party);
  if (!obj) return '';
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function formatAddress(party: unknown): string {
  const obj = asRecord(party);
  const address = asRecord(obj?.address);
  if (!address) return '';
  return [
    address.country,
    address.governate,
    address.regionCity,
    address.street,
    address.buildingNumber,
    address.postalCode,
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' · ');
}

function lineTaxes(line: PurchaseLine): Array<Record<string, unknown>> {
  if (Array.isArray(line.taxesJson)) return line.taxesJson as Array<Record<string, unknown>>;
  if (Array.isArray(line.taxes)) return line.taxes as Array<Record<string, unknown>>;
  return [];
}

function PartyCard({
  title,
  party,
  fallbackName,
  fallbackType,
  fallbackId,
  t,
}: {
  title: string;
  party: unknown;
  fallbackName?: string | null;
  fallbackType?: string | null;
  fallbackId?: string | null;
  t: ReturnType<typeof useTranslations<'purchases'>>;
}) {
  const name = partyField(party, 'name') || fallbackName || '—';
  const type = partyField(party, 'type') || fallbackType || '—';
  const id = partyField(party, 'id') || fallbackId || '—';
  const address = formatAddress(party);

  return (
    <section className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
      <h2 className="font-medium text-brand">{title}</h2>
      <dl className="grid grid-cols-1 gap-token-xs text-token-sm sm:grid-cols-2">
        <div>
          <dt className="text-foreground/60">{t('partyName')}</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('partyType')}</dt>
          <dd>{type}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-foreground/60">{t('partyId')}</dt>
          <dd className="break-all font-mono text-token-xs">{id}</dd>
        </div>
        {address ? (
          <div className="sm:col-span-2">
            <dt className="text-foreground/60">{t('address')}</dt>
            <dd>{address}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

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
  const [showRaw, setShowRaw] = useState(false);

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

  const downloadBlob = async (fn: () => Promise<{ blob: Blob; filename: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await fn();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
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
  const lines = (doc.lines ?? []) as PurchaseLine[];

  return (
    <div className="w-full space-y-token-lg">
      <Link href={`/${locale}/purchases`} className="text-brand text-token-sm">
        ← {t('back')}
      </Link>
      <h1 className="font-display text-token-2xl text-brand">
        {doc.issuerName ?? doc.documentUuid}
      </h1>

      <dl className="grid grid-cols-1 gap-token-sm rounded border border-border bg-surface p-token-sm text-token-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div>
          <dt className="text-foreground/60">{t('kind')}</dt>
          <dd>{doc.kind}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('etaStatus')}</dt>
          <dd>{doc.etaStatus ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('issued')}</dt>
          <dd>{doc.dateTimeIssued ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('internalId')}</dt>
          <dd>{doc.internalId ?? '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-foreground/60">{t('uuid')}</dt>
          <dd className="break-all font-mono text-token-xs">{doc.documentUuid}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-foreground/60">{t('longId')}</dt>
          <dd className="break-all font-mono text-token-xs">{doc.etaLongId ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('netAmount')}</dt>
          <dd>
            {doc.netAmount ?? '—'} {doc.currency ?? ''}
          </dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('total')}</dt>
          <dd className="font-medium">
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
        {doc.needsAttention ? (
          <div className="sm:col-span-2 text-danger lg:col-span-3 xl:col-span-4">
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
          className="rounded border border-border px-token-md py-token-sm text-token-sm disabled:opacity-50"
          onClick={() => void downloadBlob(() => downloadPurchaseLocalPrintout(id, locale))}
        >
          {t('localPreview')}
        </button>
        <button
          type="button"
          disabled={busy || !doc.printoutAvailable}
          title={!doc.printoutAvailable ? t('printoutUnavailable') : undefined}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white disabled:opacity-50"
          onClick={() => void downloadBlob(() => downloadPurchasePrintout(id))}
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

      <div className="grid grid-cols-1 gap-token-lg lg:grid-cols-2">
        <PartyCard
          title={t('issuer')}
          party={doc.issuerJson}
          fallbackName={doc.issuerName}
          fallbackType={doc.issuerType}
          fallbackId={doc.issuerId}
          t={t}
        />
        <PartyCard title={t('receiver')} party={doc.receiverJson} t={t} />
      </div>

      <section className="space-y-token-sm">
        <h2 className="font-display text-token-lg text-brand">{t('lines')}</h2>
        {lines.length === 0 ? (
          <p className="text-foreground/70 text-token-sm">{t('noLines')}</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[56rem] border-collapse text-token-xs">
              <thead>
                <tr className="border-b border-border bg-surface text-foreground/60">
                  <th className="px-token-sm py-token-xs text-start font-medium">#</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('itemType')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('itemCode')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('description')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('quantity')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('unitType')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('unitPrice')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('lineNet')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('lineTotal')}</th>
                  <th className="px-token-sm py-token-xs text-start font-medium">{t('taxes')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const taxes = lineTaxes(line);
                  return (
                    <tr key={String(line.id ?? i)} className="align-top border-b border-border/60">
                      <td className="px-token-sm py-token-xs text-foreground/60">
                        {line.lineNumber ?? i + 1}
                      </td>
                      <td className="px-token-sm py-token-xs">{String(line.itemType ?? '—')}</td>
                      <td className="px-token-sm py-token-xs font-mono">
                        {String(line.itemCode ?? '—')}
                      </td>
                      <td className="px-token-sm py-token-xs">
                        {String(line.description ?? '—')}
                      </td>
                      <td className="px-token-sm py-token-xs">{String(line.quantity ?? '—')}</td>
                      <td className="px-token-sm py-token-xs">{String(line.unitType ?? '—')}</td>
                      <td className="px-token-sm py-token-xs">{String(line.unitPrice ?? '—')}</td>
                      <td className="px-token-sm py-token-xs">{String(line.netTotal ?? '—')}</td>
                      <td className="px-token-sm py-token-xs font-medium">
                        {String(line.total ?? '—')}
                      </td>
                      <td className="px-token-sm py-token-xs">
                        {taxes.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="space-y-token-xs">
                            {taxes.map((tx, ti) => (
                              <li key={ti}>
                                {String(tx.taxType ?? tx.TaxType ?? '')}/
                                {String(tx.subType ?? tx.subtype ?? tx.SubType ?? '')}{' '}
                                {String(tx.rate ?? tx.ratePercent ?? '')}%
                                {tx.amount != null ? ` = ${String(tx.amount)}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-token-sm rounded border border-border bg-surface p-token-sm">
        <h2 className="font-medium text-brand">{t('totals')}</h2>
        <dl className="grid grid-cols-1 gap-token-sm text-token-sm sm:grid-cols-3">
          <div>
            <dt className="text-foreground/60">{t('netAmount')}</dt>
            <dd>
              {doc.netAmount ?? '—'} {doc.currency ?? ''}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/60">{t('total')}</dt>
            <dd className="font-medium">
              {doc.totalAmount ?? '—'} {doc.currency ?? ''}
            </dd>
          </div>
        </dl>
      </section>

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

      {doc.rawDetailsJson ? (
        <section className="space-y-token-sm">
          <button
            type="button"
            className="text-token-sm text-brand"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? `▾ ${t('rawDetails')}` : `▸ ${t('rawDetails')}`}
          </button>
          {showRaw ? (
            <pre className="max-h-96 overflow-auto rounded border border-border bg-surface p-token-sm text-token-xs">
              {JSON.stringify(doc.rawDetailsJson, null, 2)}
            </pre>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
