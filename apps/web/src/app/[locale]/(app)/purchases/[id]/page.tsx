'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
} from '@/lib/api/purchases';
import { formatMoneyDisplay, formatQuantityDisplay } from '@/lib/format-number';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyButton } from '@/components/ui/copy-button';
import { PurchaseStatusBadge } from '../_components/purchase-status-badge';
import { Ltr, PurchasePartyCard } from '../_components/purchase-party-card';
import {
  asRecord,
  formatLineTaxLabel,
  lineTaxes,
} from '../_components/purchase-tax';
import { buyerDecisionBadgeVariant } from '../_components/purchase-list-utils';

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

export default function PurchaseDetailPage() {
  const t = useTranslations('purchases');
  const tNav = useTranslations('nav');
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
        setError(null);
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
      <div className="space-y-token-lg" data-testid="purchase-detail">
        <PageHeader
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: tNav('purchases'), href: `/${locale}/purchases` },
                { label: error ? t('title') : t('loading') },
              ]}
            />
          }
          title={t('title')}
        />
        {error ? (
          <Card className="border-danger" role="alert" data-testid="purchase-detail-error">
            <p className="m-0 text-token-sm font-medium text-danger">{error}</p>
            <Button className="mt-token-sm" size="sm" variant="secondary" onClick={() => reload()}>
              {t('retryLoad')}
            </Button>
          </Card>
        ) : (
          <div data-testid="purchase-detail-loading" className="space-y-token-sm" aria-busy="true">
            <Skeleton variant="rect" className="h-token-xl" />
            <Skeleton variant="rect" className="h-[16rem]" />
          </div>
        )}
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
    taxTotals = doc.taxTotals.map((row) => ({
      taxType: String(row.taxType ?? ''),
      amount: String(row.amount ?? '0'),
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

  const etaStatusLabel = (() => {
    const status = String(doc.etaStatus ?? '').toLowerCase();
    if (status === 'valid') return t('etaStatusValid');
    if (status === 'invalid') return t('etaStatusInvalid');
    if (status === 'rejected') return t('etaStatusRejected');
    if (status === 'cancelled') return t('etaStatusCancelled');
    if (status === 'submitted') return t('etaStatusSubmitted');
    return doc.etaStatus ?? '—';
  })();

  return (
    <div className="w-full space-y-token-lg pb-[4.5rem]" data-testid="purchase-detail">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('purchases'), href: `/${locale}/purchases` },
              { label: doc.internalId || doc.issuerName || t('title') },
            ]}
          />
        }
        title={doc.issuerName ?? doc.documentUuid}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-token-sm">
            <PurchaseStatusBadge status={doc.etaStatus} label={etaStatusLabel} />
            <Badge variant={buyerDecisionBadgeVariant(doc.buyerDecision)}>
              {doc.buyerDecision}
            </Badge>
          </span>
        }
      />

      <Card>
        <dl className="grid grid-cols-1 gap-token-sm text-token-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div>
            <dt className="text-foreground-muted">{t('kind')}</dt>
            <dd>{doc.kind}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('etaStatus')}</dt>
            <dd>
              <PurchaseStatusBadge status={doc.etaStatus} label={etaStatusLabel} />
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('issued')}</dt>
            <dd>
              <Ltr>{doc.dateTimeIssued ?? '—'}</Ltr>
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('internalId')}</dt>
            <dd>
              <span dir="ltr" className="font-en">
                {doc.internalId ?? '—'}
              </span>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-foreground-muted">{t('uuid')}</dt>
            <dd className="inline-flex max-w-full items-center gap-token-xs">
              <span className="break-all font-en text-token-xs">{doc.documentUuid}</span>
              <CopyButton value={doc.documentUuid} />
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-foreground-muted">{t('longId')}</dt>
            <dd className="inline-flex max-w-full items-center gap-token-xs">
              <span className="break-all font-en text-token-xs">{doc.etaLongId ?? '—'}</span>
              {doc.etaLongId ? <CopyButton value={doc.etaLongId} /> : null}
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('netAmount')}</dt>
            <dd>
              <Ltr>
                {formatMoneyDisplay(doc.netAmount)} {doc.currency ?? ''}
              </Ltr>
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('total')}</dt>
            <dd className="font-medium">
              <Ltr>
                {formatMoneyDisplay(doc.totalAmount)} {doc.currency ?? ''}
              </Ltr>
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">{t('decision')}</dt>
            <dd>
              <Badge variant={buyerDecisionBadgeVariant(doc.buyerDecision)}>
                {doc.buyerDecision}
              </Badge>
              {doc.buyerDecisionReason ? ` — ${doc.buyerDecisionReason}` : ''}
            </dd>
          </div>
          {doc.needsAttention ? (
            <div className="text-danger sm:col-span-2 lg:col-span-3 xl:col-span-4">
              {doc.needsAttentionReason ?? t('needsAttention')}
            </div>
          ) : null}
        </dl>
      </Card>

      {error ? (
        <p className="rounded-lg border-2 border-danger bg-danger/10 px-token-md py-token-md text-token-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-token-sm">
        <Button
          variant="secondary"
          disabled={busy || terminal}
          onClick={() => void run(() => acceptPurchase(id))}
        >
          {t('accept')}
        </Button>
        <Button
          variant="danger"
          disabled={busy || terminal || !reason.trim()}
          onClick={() => void run(() => rejectPurchase(id, reason))}
        >
          {t('reject')}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || terminal}
          onClick={() => void run(() => declinePurchaseCancelation(id))}
        >
          {t('declineCancelation')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setPreviewOpen(true)}>
          {t('localPreview')}
        </Button>
        <Button
          disabled={busy || !doc.printoutAvailable}
          title={!doc.printoutAvailable ? t('printoutUnavailable') : undefined}
          onClick={() => void downloadBlob(() => downloadPurchasePrintout(id))}
        >
          {t('downloadPdf')}
        </Button>
      </div>

      <Input
        label={t('rejectReason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={terminal}
      />

      <div className="grid grid-cols-1 gap-token-lg lg:grid-cols-2">
        <PurchasePartyCard
          title={t('issuer')}
          party={doc.issuerJson}
          fallbackName={doc.issuerName}
          fallbackType={doc.issuerType}
          fallbackId={doc.issuerId}
          t={t}
          locale={locale}
        />
        <PurchasePartyCard title={t('receiver')} party={doc.receiverJson} t={t} locale={locale} />
      </div>

      <section className="space-y-token-sm">
        <h2 className="m-0 text-token-sm font-semibold text-foreground">{t('lines')}</h2>
        {lines.length === 0 ? (
          <p className="text-token-sm text-foreground-muted">{t('noLines')}</p>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[56rem] border-collapse text-token-xs">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{t('itemType')}</Th>
                  <Th>{t('itemCode')}</Th>
                  <Th>{t('description')}</Th>
                  <Th>{t('quantity')}</Th>
                  <Th>{t('unitType')}</Th>
                  <Th align="end">{t('unitPrice')}</Th>
                  <Th align="end">{t('lineNet')}</Th>
                  <Th align="end">{t('lineTotal')}</Th>
                  <Th>{t('taxes')}</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const taxes = lineTaxes(line);
                  return (
                    <tr key={String(line.id ?? i)} className="align-top">
                      <Td className="text-foreground-muted">{line.lineNumber ?? i + 1}</Td>
                      <Td>{String(line.itemType ?? '—')}</Td>
                      <Td className="font-en">{String(line.itemCode ?? '—')}</Td>
                      <Td>{String(line.description ?? '—')}</Td>
                      <Td>
                        <Ltr>{formatQuantityDisplay(line.quantity)}</Ltr>
                      </Td>
                      <Td>{String(line.unitType ?? '—')}</Td>
                      <Td align="end">
                        <Ltr>{formatMoneyDisplay(line.unitPrice)}</Ltr>
                      </Td>
                      <Td align="end">
                        <Ltr>{formatMoneyDisplay(line.netTotal)}</Ltr>
                      </Td>
                      <Td align="end" className="font-medium">
                        <Ltr>{formatMoneyDisplay(line.total)}</Ltr>
                      </Td>
                      <Td>
                        {taxes.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="m-0 list-none space-y-token-xs p-0">
                            {taxes.map((tx, ti) => (
                              <li key={ti}>
                                <Ltr>{formatLineTaxLabel(tx)}</Ltr>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      <Card className="space-y-token-sm">
        <CardTitle>{t('totals')}</CardTitle>
        <dl className="grid grid-cols-1 gap-token-sm text-token-sm sm:grid-cols-2 lg:grid-cols-3">
          {totalSales != null ? (
            <div>
              <dt className="text-foreground-muted">{t('totalSales')}</dt>
              <dd>
                <Ltr>
                  {formatMoneyDisplay(totalSales)} {doc.currency ?? ''}
                </Ltr>
              </dd>
            </div>
          ) : null}
          {totalDiscount != null && String(totalDiscount) !== '0' ? (
            <div>
              <dt className="text-foreground-muted">{t('totalDiscount')}</dt>
              <dd>
                <Ltr>
                  {formatMoneyDisplay(totalDiscount)} {doc.currency ?? ''}
                </Ltr>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-foreground-muted">{t('netAmount')}</dt>
            <dd>
              <Ltr>
                {formatMoneyDisplay(doc.netAmount)} {doc.currency ?? ''}
              </Ltr>
            </dd>
          </div>
          {taxTotals.length ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-foreground-muted">{t('taxTotals')}</dt>
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
            <dt className="text-foreground-muted">{t('total')}</dt>
            <dd className="font-medium">
              <Ltr>
                {formatMoneyDisplay(doc.totalAmount)} {doc.currency ?? ''}
              </Ltr>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-token-sm">
        <CardTitle>{t('reconciliation')}</CardTitle>
        <Select
          label={t('filterReconciliation')}
          value={recon}
          onChange={(e) => setRecon(e.target.value)}
        >
          <option value="PENDING_REVIEW">{t('reconPending')}</option>
          <option value="RECONCILED">{t('reconReconciled')}</option>
          <option value="DISPUTED">{t('reconDisputed')}</option>
        </Select>
        <Input
          label={t('reconNote')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={busy}
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
        </Button>
      </Card>

      {doc.rawDetailsJson ? (
        <section className="space-y-token-sm">
          <Button variant="link" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? `▾ ${t('rawDetails')}` : `▸ ${t('rawDetails')}`}
          </Button>
          {showRaw ? (
            <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface p-token-sm text-token-xs">
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
