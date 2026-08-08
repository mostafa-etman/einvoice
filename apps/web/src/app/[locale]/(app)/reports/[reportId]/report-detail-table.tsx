'use client';

import { Fragment, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoneyDisplay, formatQuantityDisplay } from '@/lib/format-number';

type TaxRow = {
  taxType?: string;
  taxTypeNameEn?: string | null;
  taxTypeNameAr?: string | null;
  subType?: string;
  subTypeNameEn?: string | null;
  subTypeNameAr?: string | null;
  rate?: string;
  amount?: string;
};

type LineRow = {
  lineNumber?: number;
  itemName?: string | null;
  itemCode?: string | null;
  itemType?: string | null;
  description?: string | null;
  quantity?: string | null;
  unitType?: string | null;
  unitPrice?: string | null;
  discountAmount?: string | null;
  netTotal?: string | null;
  total?: string | null;
  taxes?: TaxRow[];
};

export type DetailDocRow = Record<string, unknown> & {
  id?: string;
  internalId?: string | null;
  etaUuid?: string | null;
  etaLongId?: string | null;
  kind?: string;
  issueDate?: string | null;
  receiverName?: string | null;
  receiverId?: string | null;
  issuerName?: string | null;
  issuerId?: string | null;
  netAmount?: string | null;
  totalDiscountAmount?: string | null;
  totalAmount?: string | null;
  currencyCode?: string | null;
  status?: string | null;
  taxesSummaryEn?: string;
  taxesSummaryAr?: string;
  taxes?: TaxRow[];
  lines?: LineRow[];
};

function pickLocaleName(
  locale: string,
  nameEn: unknown,
  nameAr: unknown,
  fallback: unknown,
): string {
  const en = String(nameEn ?? '').trim();
  const ar = String(nameAr ?? '').trim();
  const fb = String(fallback ?? '').trim();
  if (locale === 'ar') return ar || en || fb;
  return en || ar || fb;
}

function formatTaxLine(locale: string, t: TaxRow): string {
  const name = pickLocaleName(
    locale,
    t.taxTypeNameEn,
    t.taxTypeNameAr,
    t.taxType,
  );
  const sub = t.subType
    ? pickLocaleName(locale, t.subTypeNameEn, t.subTypeNameAr, t.subType)
    : '';
  const label = sub ? `${name}/${sub}` : name;
  return `${label} ${t.rate ?? '0'}%: ${formatMoneyDisplay(t.amount)}`;
}

type Props = {
  side: 'sales' | 'purchases';
  rows: DetailDocRow[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  documentCount: number;
};

export function ReportDetailDocumentsTable({
  side,
  rows,
  sortBy,
  sortDir,
  onSort,
  hasMore,
  loadingMore,
  onLoadMore,
  documentCount,
}: Props) {
  const t = useTranslations('reports');
  const td = useTranslations('documents');
  const tp = useTranslations('purchases');
  const locale = useLocale();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const kindLabel = (kind: string) => {
    if (side === 'sales') {
      try {
        switch (kind) {
          case 'INVOICE':
            return td('kindInvoice');
          case 'CREDIT_NOTE':
            return td('kindCreditNote');
          case 'DEBIT_NOTE':
            return td('kindDebitNote');
          case 'EXPORT_INVOICE':
            return td('kindExportInvoice');
          case 'EXPORT_CREDIT_NOTE':
            return td('kindExportCreditNote');
          case 'EXPORT_DEBIT_NOTE':
            return td('kindExportDebitNote');
          default:
            return kind;
        }
      } catch {
        return kind;
      }
    }
    try {
      switch (kind) {
        case 'PURCHASE_INVOICE':
          return tp('kindInvoice');
        case 'PURCHASE_RETURN':
          return tp('kindReturn');
        case 'OTHER_RECEIVED':
          return tp('kindOther');
        default:
          return kind;
      }
    } catch {
      return kind;
    }
  };

  const sortMark = (field: string) => {
    if (sortBy !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const headers = useMemo(() => {
    const party =
      side === 'sales'
        ? t('detail.receiver')
        : t('detail.seller');
    const partyTax =
      side === 'sales'
        ? t('detail.receiverTaxId')
        : t('detail.sellerTaxId');
    const taxes =
      side === 'sales' ? t('detail.outputTaxes') : t('detail.inputTaxes');
    return [
      { key: 'expand', label: '', sortable: false },
      {
        key: side === 'sales' ? 'internalId' : 'internalId',
        label: t('detail.internalId'),
        sortable: true,
        sortField: 'internalId',
      },
      { key: 'etaUuid', label: t('detail.etaUuid'), sortable: false },
      { key: 'kind', label: t('detail.docType'), sortable: false },
      {
        key: 'issueDate',
        label: t('detail.issueDate'),
        sortable: true,
        sortField: side === 'sales' ? 'issueDateTime' : 'dateTimeIssued',
      },
      {
        key: 'party',
        label: party,
        sortable: true,
        sortField: side === 'sales' ? 'receiverName' : 'issuerName',
      },
      { key: 'partyTax', label: partyTax, sortable: false },
      { key: 'net', label: t('fields.net'), sortable: false },
      { key: 'discount', label: t('detail.discount'), sortable: false },
      { key: 'taxes', label: taxes, sortable: false },
      {
        key: 'total',
        label: t('fields.total'),
        sortable: true,
        sortField: 'totalAmount',
      },
      { key: 'currency', label: t('fields.currencyCode'), sortable: false },
      {
        key: 'status',
        label: t('fields.status'),
        sortable: true,
        sortField: side === 'sales' ? 'status' : 'etaStatus',
      },
    ] as Array<{
      key: string;
      label: string;
      sortable: boolean;
      sortField?: string;
    }>;
  }, [side, t]);

  return (
    <div className="space-y-token-sm">
      <p className="text-sm text-muted">
        {t('detail.showing', {
          shown: rows.length,
          total: documentCount,
        })}
      </p>
      <section className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-surface">
            <tr>
              {headers.map((h) => (
                <th
                  key={h.key}
                  className="border-b border-border px-3 py-2 text-start font-medium whitespace-nowrap"
                >
                  {h.sortable && h.sortField ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => onSort(h.sortField!)}
                    >
                      {h.label}
                      {sortMark(h.sortField)}
                    </button>
                  ) : (
                    h.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-3 py-6 text-center text-muted"
                >
                  {t('detail.empty')}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const id = String(row.id ?? '');
              const isOpen = expanded.has(id);
              const partyName =
                side === 'sales' ? row.receiverName : row.issuerName;
              const partyTax =
                side === 'sales' ? row.receiverId : row.issuerId;
              const taxSummary = pickLocaleName(
                locale,
                row.taxesSummaryEn,
                row.taxesSummaryAr,
                '',
              );
              const lines = Array.isArray(row.lines) ? row.lines : [];
              return (
                <Fragment key={id}>
                  <tr className="odd:bg-background even:bg-surface/40">
                    <td className="border-b border-border px-2 py-2">
                      <button
                        type="button"
                        className="rounded border border-border px-2 py-0.5 text-xs"
                        onClick={() => toggle(id)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? '−' : '+'}
                      </button>
                    </td>
                    <td className="border-b border-border px-3 py-2" dir="ltr">
                      {row.internalId ?? '—'}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2 max-w-[12rem] truncate"
                      dir="ltr"
                      title={String(row.etaUuid ?? row.etaLongId ?? '')}
                    >
                      {row.etaUuid || row.etaLongId || '—'}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {kindLabel(String(row.kind ?? ''))}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2 tabular-nums"
                      dir="ltr"
                    >
                      {row.issueDate ?? '—'}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {partyName || '—'}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2"
                      dir="ltr"
                    >
                      {partyTax || '—'}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2 tabular-nums"
                      dir="ltr"
                    >
                      {formatMoneyDisplay(row.netAmount)}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2 tabular-nums"
                      dir="ltr"
                    >
                      {formatMoneyDisplay(row.totalDiscountAmount)}
                    </td>
                    <td className="border-b border-border px-3 py-2 max-w-[16rem] text-xs">
                      {taxSummary || '—'}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2 tabular-nums"
                      dir="ltr"
                    >
                      {formatMoneyDisplay(row.totalAmount)}
                    </td>
                    <td
                      className="border-b border-border px-3 py-2"
                      dir="ltr"
                    >
                      {row.currencyCode ?? '—'}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {row.status ?? '—'}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="bg-surface/60">
                      <td
                        colSpan={headers.length}
                        className="border-b border-border px-4 py-3"
                      >
                        <div className="mb-2 text-xs font-medium text-muted">
                          {t('detail.lineItems')}
                        </div>
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr>
                              <th className="px-2 py-1 text-start">
                                {t('detail.item')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('fields.quantity')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('detail.unit')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('detail.unitPrice')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('detail.discount')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('detail.lineNet')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('detail.lineTaxes')}
                              </th>
                              <th className="px-2 py-1 text-start">
                                {t('detail.lineTotal')}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={8}
                                  className="px-2 py-2 text-muted"
                                >
                                  {t('detail.noLines')}
                                </td>
                              </tr>
                            ) : null}
                            {lines.map((line, i) => {
                              const itemLabel =
                                [line.itemName, line.itemCode, line.description]
                                  .filter((x) => x && String(x).trim())
                                  .join(' · ') || '—';
                              const lineTaxStr = (line.taxes ?? [])
                                .map((tx) => formatTaxLine(locale, tx))
                                .join(' · ');
                              return (
                                <tr key={`${id}-l-${i}`}>
                                  <td className="px-2 py-1">{itemLabel}</td>
                                  <td
                                    className="px-2 py-1 tabular-nums"
                                    dir="ltr"
                                  >
                                    {formatQuantityDisplay(line.quantity)}
                                  </td>
                                  <td className="px-2 py-1" dir="ltr">
                                    {line.unitType ?? '—'}
                                  </td>
                                  <td
                                    className="px-2 py-1 tabular-nums"
                                    dir="ltr"
                                  >
                                    {formatMoneyDisplay(line.unitPrice)}
                                  </td>
                                  <td
                                    className="px-2 py-1 tabular-nums"
                                    dir="ltr"
                                  >
                                    {formatMoneyDisplay(line.discountAmount)}
                                  </td>
                                  <td
                                    className="px-2 py-1 tabular-nums"
                                    dir="ltr"
                                  >
                                    {formatMoneyDisplay(line.netTotal)}
                                  </td>
                                  <td className="px-2 py-1">{lineTaxStr || '—'}</td>
                                  <td
                                    className="px-2 py-1 tabular-nums"
                                    dir="ltr"
                                  >
                                    {formatMoneyDisplay(line.total)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {(row.issuerName || row.receiverName) && (
                          <div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                            {row.issuerName ? (
                              <div>
                                {t('detail.issuer')}: {String(row.issuerName)}
                                {row.issuerId
                                  ? ` (${String(row.issuerId)})`
                                  : ''}
                              </div>
                            ) : null}
                            {row.receiverName ? (
                              <div>
                                {t('detail.receiver')}:{' '}
                                {String(row.receiverName)}
                                {row.receiverId
                                  ? ` (${String(row.receiverId)})`
                                  : ''}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
      {hasMore ? (
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? t('loading') : t('detail.loadMore')}
        </button>
      ) : null}
    </div>
  );
}
