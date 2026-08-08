'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LocalPdfPreviewModal } from '@/components/local-pdf-preview-modal';
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
  type PurchaseLineTax,
} from '@/lib/api/purchases';
import { partyTypeLabel } from '@/lib/eta-display';
import { formatMoneyDisplay, formatQuantityDisplay } from '@/lib/format-number';

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

function normalizeTax(raw: Record<string, unknown>): PurchaseLineTax | null {
  const taxType = String(raw.taxType ?? raw.TaxType ?? raw.type ?? '').trim();
  const subType = String(
    raw.subType ?? raw.subtype ?? raw.SubType ?? raw.taxSubType ?? '',
  ).trim();
  const rate = String(raw.rate ?? raw.ratePercent ?? raw.Rate ?? '').trim();
  const amount =
    raw.amount != null
      ? String(raw.amount)
      : raw.Amount != null
        ? String(raw.Amount)
        : undefined;
  if (!taxType && !subType && amount == null) return null;
  return { taxType, subType, rate, amount };
}

/**
 * Same sources the PDF uses: normalized `taxes`, non-empty taxesJson,
 * then ETA lineTaxableItems / taxableItems on rawJson.
 */
function lineTaxes(line: PurchaseLine): PurchaseLineTax[] {
  if (Array.isArray(line.taxes) && line.taxes.length) {
    return (line.taxes as Array<Record<string, unknown>>)
      .map(normalizeTax)
      .filter((t): t is PurchaseLineTax => t != null);
  }
  if (Array.isArray(line.taxesJson) && line.taxesJson.length) {
    return (line.taxesJson as Array<Record<string, unknown>>)
      .map(normalizeTax)
      .filter((t): t is PurchaseLineTax => t != null);
  }
  const raw = asRecord(line.rawJson);
  if (raw) {
    for (const key of [
      'lineTaxableItems',
      'LineTaxableItems',
      'taxableItems',
      'TaxableItems',
      'taxItems',
      'taxes',
    ]) {
      const v = raw[key];
      if (Array.isArray(v) && v.length) {
        return (v as Array<Record<string, unknown>>)
          .map(normalizeTax)
          .filter((t): t is PurchaseLineTax => t != null);
      }
    }
  }
  return [];
}

function formatLineTaxLabel(tx: PurchaseLineTax): string {
  const code = [tx.taxType, tx.subType].filter(Boolean).join('/');
  const rate = tx.rate ? `${tx.rate}%` : '';
  const amt =
    tx.amount != null && tx.amount !== ''
      ? `=${formatMoneyDisplay(tx.amount)}`
      : '';
  return [code, rate, amt].filter(Boolean).join(' ');
}

function taxSummaryLabel(
  taxType: string,
  t: ReturnType<typeof useTranslations<'purchases'>>,
): string {
  if (/^T1$/i.test(taxType)) return `${t('vatSummary')} (${taxType})`;
  if (/^T4$/i.test(taxType) || /W/i.test(taxType)) {
    return `${t('withholdingSummary')} (${taxType})`;
  }
  return taxType;
}

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="inline-block tabular-nums">
      {children}
    </span>
  );
}

function PartyCard({
  title,
  party,
  fallbackName,
  fallbackType,
  fallbackId,
  t,
  locale,
}: {
  title: string;
  party: unknown;
  fallbackName?: string | null;
  fallbackType?: string | null;
  fallbackId?: string | null;
  t: ReturnType<typeof useTranslations<'purchases'>>;
  locale: string;
}) {
  const name = partyField(party, 'name') || fallbackName || '—';
  const typeCode = partyField(party, 'type') || fallbackType || '';
  const type = partyTypeLabel(typeCode, locale === 'ar' ? 'ar' : 'en');
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
  const [previewOpen, setPreviewOpen] = useState(false);

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
  const details = asRecord(doc.rawDetailsJson);

  let taxTotals: Array<{ taxType: string; amount: string }> = [];
  if (Array.isArray(doc.taxTotals) && doc.taxTotals.length) {
    taxTotals = doc.taxTotals.map((t) => ({
      taxType: String(t.taxType ?? ''),
      amount: String(t.amount ?? '0'),
    }));
  } else {
    const fromDetails = details?.taxTotals ?? details?.TaxTotals;
    if (Array.isArray(fromDetails) && fromDetails.length) {
      taxTotals = (fromDetails as Array<Record<string, unknown>>).map((row) => ({
        taxType: String(row.taxType ?? row.TaxType ?? row.type ?? ''),
        amount: String(row.amount ?? row.Amount ?? '0'),
      }));
    } else {
      const map = new Map<string, number>();
      for (const line of lines) {
        for (const tx of lineTaxes(line)) {
          const key = tx.taxType || 'TAX';
          const n = Number(String(tx.amount ?? '0').replace(/,/g, ''));
          if (!Number.isFinite(n)) continue;
          map.set(key, (map.get(key) ?? 0) + n);
        }
      }
      taxTotals = [...map.entries()].map(([taxType, amount]) => ({
        taxType,
        amount: amount.toFixed(2),
      }));
    }
  }

  const totalSales = details?.totalSales ?? details?.totalSalesAmount ?? doc.netAmount;
  const totalDiscount = details?.totalDiscount ?? details?.totalDiscountAmount;

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
            <Ltr>
              {formatMoneyDisplay(doc.netAmount)} {doc.currency ?? ''}
            </Ltr>
          </dd>
        </div>
        <div>
          <dt className="text-foreground/60">{t('total')}</dt>
          <dd className="font-medium">
            <Ltr>
              {formatMoneyDisplay(doc.totalAmount)} {doc.currency ?? ''}
            </Ltr>
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
          onClick={() => setPreviewOpen(true)}
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
          locale={locale}
        />
        <PartyCard title={t('receiver')} party={doc.receiverJson} t={t} locale={locale} />
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
                      <td className="px-token-sm py-token-xs">
                        <Ltr>{formatQuantityDisplay(line.quantity)}</Ltr>
                      </td>
                      <td className="px-token-sm py-token-xs">{String(line.unitType ?? '—')}</td>
                      <td className="px-token-sm py-token-xs">
                        <Ltr>{formatMoneyDisplay(line.unitPrice)}</Ltr>
                      </td>
                      <td className="px-token-sm py-token-xs">
                        <Ltr>{formatMoneyDisplay(line.netTotal)}</Ltr>
                      </td>
                      <td className="px-token-sm py-token-xs font-medium">
                        <Ltr>{formatMoneyDisplay(line.total)}</Ltr>
                      </td>
                      <td className="px-token-sm py-token-xs">
                        {taxes.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="space-y-token-xs">
                            {taxes.map((tx, ti) => (
                              <li key={ti}>
                                <Ltr>{formatLineTaxLabel(tx)}</Ltr>
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
        <dl className="grid grid-cols-1 gap-token-sm text-token-sm sm:grid-cols-2 lg:grid-cols-3">
          {totalSales != null ? (
            <div>
              <dt className="text-foreground/60">{t('totalSales')}</dt>
              <dd>
                <Ltr>
                  {formatMoneyDisplay(totalSales)} {doc.currency ?? ''}
                </Ltr>
              </dd>
            </div>
          ) : null}
          {totalDiscount != null && String(totalDiscount) !== '0' ? (
            <div>
              <dt className="text-foreground/60">{t('totalDiscount')}</dt>
              <dd>
                <Ltr>
                  {formatMoneyDisplay(totalDiscount)} {doc.currency ?? ''}
                </Ltr>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-foreground/60">{t('netAmount')}</dt>
            <dd>
              <Ltr>
                {formatMoneyDisplay(doc.netAmount)} {doc.currency ?? ''}
              </Ltr>
            </dd>
          </div>
          {taxTotals.length ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-foreground/60">{t('taxTotals')}</dt>
              <dd>
                <ul className="mt-token-xs space-y-token-xs">
                  {taxTotals.map((tt) => (
                    <li key={tt.taxType}>
                      {taxSummaryLabel(tt.taxType, t)}:{' '}
                      <Ltr>
                        {formatMoneyDisplay(tt.amount)} {doc.currency ?? ''}
                      </Ltr>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-foreground/60">{t('total')}</dt>
            <dd className="font-medium">
              <Ltr>
                {formatMoneyDisplay(doc.totalAmount)} {doc.currency ?? ''}
              </Ltr>
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
            <option value="PENDING_REVIEW">{t('reconPending')}</option>
            <option value="RECONCILED">{t('reconReconciled')}</option>
            <option value="DISPUTED">{t('reconDisputed')}</option>
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

      <LocalPdfPreviewModal
        open={previewOpen}
        title={t('localPreview')}
        closeLabel={t('close')}
        downloadLabel={t('downloadLocalPdf')}
        loadingLabel={t('loading')}
        errorFallback={t('loading')}
        onClose={() => setPreviewOpen(false)}
        loadPdf={() => downloadPurchaseLocalPrintout(id, locale)}
      />
    </div>
  );
}
