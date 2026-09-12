'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkLateSubmission } from '@einvoice/eta-core';
import { ApiError } from '@/lib/api/client';
import {
  createReturnCreditNote,
  deleteDocument,
  downloadLocalPrintout,
  latestSalesSync,
  listDocuments,
  resetSalesSync,
  syncSales,
  type DocumentListItem,
} from '@/lib/api/documents';
import {
  cancelDocument,
  cancelDocumentsSelected,
  createSubmission,
  downloadDocumentPrintout,
  refreshDocumentStatus,
  refreshDocumentsStatus,
  triggerBrowserDownload,
  type BatchSubmitResult,
  type StatusRefreshBatchResult,
} from '@/lib/api/submissions';
import { LocalPdfPreviewModal } from '@/components/local-pdf-preview-modal';
import { canCreateReturnCreditNote, canEditDocument } from '@/lib/document-actions';
import { resolveDocumentStatus } from '@/lib/document-status-display';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { CopyButton } from '@/components/ui/copy-button';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CancelReasonDialog } from './_components/cancel-reason-dialog';
import { DocumentStatusBadge } from './_components/document-status-badge';
import {
  AUTO_POLL_MS,
  KIND_FILTERS,
  PAGE_SIZE,
  SALES_SYNC_POLL_ATTEMPTS,
  SALES_SYNC_POLL_INTERVAL_MS,
  STATUS_FILTERS,
  canCancel,
  canDownloadEta,
  formatIssueDate,
  isPendingEta,
  isSigned,
  type SortBy,
} from './_components/document-list-utils';
import { cairoExportRangeIso } from '../exports/export-date-range';

type DocRow = DocumentListItem;

type CancelBatchResult = {
  requested: number;
  cancelled: number;
  skipped: number;
  failed: number;
  results: Array<{
    documentId: string;
    internalId: string | null;
    outcome: string;
    reason?: string;
    status?: string | null;
  }>;
};

export default function DocumentsPage() {
  const t = useTranslations('documents');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const { push } = useToast();
  const [items, setItems] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listReady, setListReady] = useState(false);
  const [salesSyncing, setSalesSyncing] = useState(false);
  const [showSalesSyncReset, setShowSalesSyncReset] = useState(false);
  const [syncFrom, setSyncFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [syncTo, setSyncTo] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [receiver, setReceiver] = useState('');
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('issueDateTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<BatchSubmitResult | null>(null);
  const [lastRefresh, setLastRefresh] = useState<StatusRefreshBatchResult | null>(
    null,
  );
  const [lastCancel, setLastCancel] = useState<CancelBatchResult | null>(null);
  const [lateConfirm, setLateConfirm] = useState<{
    count: number;
    days: number;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    ids: string[];
    batch: boolean;
  } | null>(null);

  const queryParams = useCallback(
    (cursor?: string) => ({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(kindFilter ? { kind: kindFilter } : {}),
      from: from ? `${from}T00:00:00.000Z` : undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
      receiver: receiver.trim() || undefined,
      q: q.trim() || undefined,
      sortBy,
      sortDir,
      limit: PAGE_SIZE,
      cursor,
    }),
    [statusFilter, kindFilter, from, to, receiver, q, sortBy, sortDir],
  );

  const mapItems = (rows: DocumentListItem[]): DocRow[] => rows;

  const reload = useCallback(async () => {
    try {
      const res = await listDocuments(queryParams());
      setItems(mapItems(res.items));
      setNextCursor(res.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forbidden'));
    } finally {
      setListReady(true);
    }
  }, [queryParams, t]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listDocuments(queryParams(nextCursor));
      setItems((prev) => [...prev, ...mapItems(res.items)]);
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forbidden'));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    latestSalesSync()
      .then((run) => {
        if (run.status === 'PENDING' || run.status === 'RUNNING') {
          setShowSalesSyncReset(true);
        }
      })
      .catch(() => undefined);
  }, []);

  // Soft background poll for SUBMITTED docs while the list is open.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (busy) return;
      const pending = items.filter((d) => isPendingEta(d.status, d.etaUuid));
      if (!pending.length) return;
      void refreshDocumentsStatus({ pendingOnly: true })
        .then((res) => {
          if (res.updated > 0) void reload();
        })
        .catch(() => {
          /* silent — manual refresh remains available */
        });
    };
    const id = window.setInterval(tick, AUTO_POLL_MS);
    return () => window.clearInterval(id);
  }, [busy, items, reload]);

  const allIds = useMemo(() => items.map((d) => d.id), [items]);
  const allSelected =
    items.length > 0 && items.every((d) => selected.has(d.id));
  const selectedCount = selected.size;
  const selectedRows = useMemo(
    () => items.filter((d) => selected.has(d.id)),
    [items, selected],
  );
  const filtersActive = Boolean(
    statusFilter || kindFilter || from || to || receiver.trim() || q.trim(),
  );

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showToast = (message: string, tone: 'ok' | 'err' | 'info' = 'info') => {
    push({
      title: message,
      kind: tone === 'ok' ? 'success' : tone === 'err' ? 'error' : 'info',
      timeoutMs: 12000,
    });
  };

  const runSalesSync = async () => {
    setSalesSyncing(true);
    setError(null);
    try {
      await syncSales({
        from: syncFrom ? cairoExportRangeIso(syncFrom, false) : undefined,
        to: syncTo ? cairoExportRangeIso(syncTo, true) : undefined,
      });
      setShowSalesSyncReset(true);
      for (let i = 0; i < SALES_SYNC_POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, SALES_SYNC_POLL_INTERVAL_MS));
        const run = await latestSalesSync();
        if (run.status === 'SUCCEEDED') {
          setShowSalesSyncReset(false);
          showToast(
            t('salesSyncOk', {
              newCount: run.newCount,
              updatedCount: run.updatedCount,
            }),
            'ok',
          );
          await reload();
          return;
        }
        if (run.status === 'FAILED') {
          setShowSalesSyncReset(false);
          const msg = run.errorSummary || t('salesSyncFailed', { message: '—' });
          showToast(t('salesSyncFailed', { message: msg }), 'err');
          setError(msg);
          return;
        }
      }
      showToast(t('salesSyncFailed', { message: 'timeout' }), 'err');
      setShowSalesSyncReset(true);
    } catch (e) {
      const alreadyRunning =
        e instanceof ApiError &&
        e.status === 409 &&
        /already running|in progress/i.test(e.message);
      if (alreadyRunning) {
        setShowSalesSyncReset(true);
        showToast(t('salesSyncAlreadyRunning'), 'err');
        setError(t('salesSyncAlreadyRunning'));
      } else {
        const msg =
          e instanceof Error ? e.message : t('salesSyncFailed', { message: '—' });
        showToast(t('salesSyncFailed', { message: msg }), 'err');
        setError(msg);
      }
    } finally {
      setSalesSyncing(false);
    }
  };

  const runResetSalesSync = async () => {
    setSalesSyncing(true);
    setError(null);
    try {
      await resetSalesSync();
      setShowSalesSyncReset(false);
      showToast(t('salesSyncResetOk'), 'ok');
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : t('salesSyncResetFailed', { message: '—' });
      showToast(t('salesSyncResetFailed', { message: msg }), 'err');
      setError(msg);
    } finally {
      setSalesSyncing(false);
    }
  };

  const confirmLateIfNeeded = (rows: DocRow[]) => {
    const late = rows.filter((d) => {
      if (!isSigned(d.status) || !d.issueDateTime) return false;
      return checkLateSubmission(d.issueDateTime).isLate;
    });
    if (!late.length) return Promise.resolve(true);
    const sample = late[0]!;
    const check = checkLateSubmission(sample.issueDateTime!);
    return new Promise<boolean>((resolve) => {
      setLateConfirm({
        count: late.length,
        days: check.warnDays,
        resolve,
      });
    });
  };

  const runSendSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!(await confirmLateIfNeeded(selectedRows))) return;
    setBusy(true);
    setError(null);
    setLastBatch(null);
    try {
      const result = await createSubmission(ids);
      setLastBatch(result);
      const lateNote =
        result.lateWarnings?.length > 0
          ? ` — ${t('lateWarningsInBatch', {
              count: result.lateWarnings.length,
            })}`
          : '';
      showToast(
        t('batchSendSummary', {
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
        }) + lateNote,
        result.failed > 0 ? 'err' : result.sent > 0 ? 'ok' : 'info',
      );
      setSelected(new Set());
      await reload();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('submitFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const executeCancel = async (ids: string[], reason: string, batch: boolean) => {
    if (!reason.trim()) {
      setError(t('cancelReasonRequired'));
      showToast(t('cancelReasonRequired'), 'err');
      return;
    }
    setBusy(true);
    setError(null);
    setLastCancel(null);
    try {
      if (batch) {
        const result = await cancelDocumentsSelected(ids, reason.trim());
        setLastCancel(result);
        showToast(
          t('batchCancelSummary', {
            cancelled: result.cancelled,
            skipped: result.skipped,
            failed: result.failed,
          }),
        );
      } else {
        await cancelDocument(ids[0]!, reason.trim());
        showToast(t('batchCancelSummary', { cancelled: 1, skipped: 0, failed: 0 }));
      }
      setSelected(new Set());
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('forbidden');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runCancelSelected = async () => {
    const ids = selectedRows
      .filter((d) => canCancel(d.status, d.etaUuid))
      .map((d) => d.id);
    if (!ids.length) {
      setError(t('cancelNoneEligible'));
      showToast(t('cancelNoneEligible'), 'err');
      return;
    }
    setCancelTarget({ ids, batch: true });
  };

  const runRefreshSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    setLastRefresh(null);
    try {
      const result = await refreshDocumentsStatus({ documentIds: ids });
      setLastRefresh(result);
      showToast(
        t('batchRefreshSummary', {
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('refreshStatusFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runRefreshPending = async () => {
    setBusy(true);
    setError(null);
    setLastRefresh(null);
    try {
      const result = await refreshDocumentsStatus({ pendingOnly: true });
      setLastRefresh(result);
      showToast(
        t('batchRefreshSummary', {
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('refreshStatusFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runRefreshOne = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await refreshDocumentStatus(id);
      showToast(
        t('refreshOneSummary', {
          internalId: result.internalId,
          status: result.status ?? '—',
          outcome: result.outcome,
        }),
      );
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('refreshStatusFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runDownloadPrintout = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadDocumentPrintout(id);
      triggerBrowserDownload(blob, filename);
      showToast(t('downloadPrintout'), 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('downloadFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runReturnOne = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const created = await createReturnCreditNote(id);
      const newId = String(created.id ?? '');
      if (!newId) {
        setError(t('returnCreditNoteFailed'));
        showToast(t('returnCreditNoteFailed'), 'err');
        return;
      }
      router.push(`/${locale}/documents/${newId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('returnCreditNoteFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runCancelOne = async (id: string) => {
    setCancelTarget({ ids: [id], batch: false });
  };

  const runSubmitOne = async (id: string) => {
    const row = items.find((d) => d.id === id);
    if (!row || !isSigned(row.status) || row.origin === 'ETA_SYNC') return;
    if (!(await confirmLateIfNeeded([row]))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createSubmission([id]);
      setLastBatch(result);
      showToast(
        t('batchSendSummary', {
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
        }),
        result.failed > 0 ? 'err' : result.sent > 0 ? 'ok' : 'info',
      );
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('submitFailed');
      setError(msg);
      showToast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = (kind: string) => {
    switch (kind) {
      case 'INVOICE':
        return t('kindInvoice');
      case 'CREDIT_NOTE':
        return t('kindCreditNote');
      case 'DEBIT_NOTE':
        return t('kindDebitNote');
      case 'EXPORT_INVOICE':
        return t('kindExportInvoice');
      case 'EXPORT_CREDIT_NOTE':
        return t('kindExportCreditNote');
      case 'EXPORT_DEBIT_NOTE':
        return t('kindExportDebitNote');
      default:
        return kind;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return t('statusDraft');
      case 'READY':
        return t('statusReady');
      case 'PENDING_SIGNATURE':
        return t('statusPendingSignature');
      case 'SIGNED':
        return t('statusSigned');
      case 'SUBMITTED':
        return t('statusSubmitted');
      case 'VALID':
        return t('statusValid');
      case 'INVALID':
        return t('statusInvalid');
      case 'CANCELLED':
        return t('statusCancelled');
      case 'REJECTED':
        return t('statusRejected');
      default:
        return status;
    }
  };

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(
        col === 'issueDateTime' || col === 'totalAmount' ? 'desc' : 'asc',
      );
    }
    setSelected(new Set());
  };

  const sortIndicator = (col: SortBy) => {
    if (sortBy !== col) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const resetFilters = () => {
    setStatusFilter('');
    setKindFilter('');
    setFrom('');
    setTo('');
    setReceiver('');
    setQ('');
    setSelected(new Set());
  };

  return (
    <div className="space-y-token-lg" data-testid="documents-page">
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
        subtitle={`${t('listLoaded', { count: items.length })} · ${t('salesSyncRangeHint')}`}
        actions={
          <>
            <Input
              type="date"
              label={t('salesSyncFrom')}
              value={syncFrom}
              onChange={(e) => setSyncFrom(e.target.value)}
              dir="ltr"
              className="w-auto"
            />
            <Input
              type="date"
              label={t('salesSyncTo')}
              value={syncTo}
              onChange={(e) => setSyncTo(e.target.value)}
              dir="ltr"
              className="w-auto"
            />
            {showSalesSyncReset ? (
              <Button
                variant="danger"
                disabled={salesSyncing || busy}
                onClick={() => void runResetSalesSync()}
              >
                {t('salesSyncReset')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={salesSyncing || busy}
              loading={salesSyncing}
              onClick={() => void runSalesSync()}
            >
              {salesSyncing ? t('salesSyncing') : t('salesSync')}
            </Button>
            <Button
              onClick={() => router.push(`/${locale}/documents/new`)}
              data-testid="documents-new"
            >
              {t('new')}
            </Button>
          </>
        }
      />

      <FilterBar
        search={q}
        onSearchChange={(value) => {
          setQ(value);
          setSelected(new Set());
        }}
        searchPlaceholder={t('filterSearch')}
        onReset={resetFilters}
        chips={[
          {
            id: 'all',
            label: t('filterAll'),
            active: statusFilter === '',
            onClick: () => {
              setStatusFilter('');
              setSelected(new Set());
            },
          },
          ...STATUS_FILTERS.map((s) => ({
            id: s,
            label: statusLabel(s),
            active: statusFilter === s,
            onClick: () => {
              setStatusFilter(s);
              setSelected(new Set());
            },
          })),
        ]}
      >
        <Input
          type="date"
          label={t('filterFrom')}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setSelected(new Set());
          }}
          dir="ltr"
          className="w-auto"
        />
        <Input
          type="date"
          label={t('filterTo')}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setSelected(new Set());
          }}
          dir="ltr"
          className="w-auto"
        />
        <Select
          label={t('filterKind')}
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.target.value);
            setSelected(new Set());
          }}
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
          label={t('filterReceiver')}
          value={receiver}
          onChange={(e) => {
            setReceiver(e.target.value);
            setSelected(new Set());
          }}
          placeholder={t('filterReceiver')}
          className="min-w-[var(--size-search-min)]"
        />
      </FilterBar>

      {selectedCount > 0 ? (
        <section
          className="flex flex-wrap items-center gap-token-sm rounded-lg bg-navy px-token-md py-token-sm text-on-dark shadow-sm"
          data-testid="documents-bulk-bar"
        >
          <span className="text-token-sm font-medium">
            {t('selectedCount', { count: selectedCount })}
          </span>
          <div className="ms-auto flex flex-wrap gap-token-xs">
            <Button
              size="sm"
              disabled={busy || selectedCount === 0}
              loading={busy}
              onClick={() => void runSendSelected()}
            >
              {busy ? t('submitting') : t('sendSelected')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || selectedCount === 0}
              onClick={() => void runRefreshSelected()}
            >
              {t('refreshSelected')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={
                busy ||
                !selectedRows.some((d) => canCancel(d.status, d.etaUuid))
              }
              onClick={() => void runCancelSelected()}
            >
              {t('cancelSelected')}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-token-sm">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void runRefreshPending()}
        >
          {t('refreshAllPending')}
        </Button>
      </div>

      {error ? (
        <Card className="border-danger" data-testid="documents-error" role="alert">
          <p className="m-0 text-token-sm font-medium text-danger">{error}</p>
          <Button className="mt-token-sm" size="sm" variant="secondary" onClick={() => void reload()}>
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      {lastBatch ? (
        <details className="rounded-lg border border-border bg-surface px-token-md py-token-sm text-token-sm shadow-sm">
          <summary>
            {t('batchSendDetails', {
              sent: lastBatch.sent,
              skipped: lastBatch.skipped,
              failed: lastBatch.failed,
            })}
          </summary>
          {lastBatch.lateWarnings?.length ? (
            <p className="mt-token-sm text-warning">
              {t('lateWarningsInBatch', {
                count: lastBatch.lateWarnings.length,
              })}
            </p>
          ) : null}
          <ul className="mt-token-sm space-y-token-xs">
            {lastBatch.results.map((r) => (
              <li key={r.documentId}>
                {r.internalId ?? r.documentId}: {r.outcome}
                {r.reason ? ` (${r.reason})` : ''}
                {r.documentStatus ? ` → ${r.documentStatus}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {lastRefresh ? (
        <details className="rounded-lg border border-border bg-surface px-token-md py-token-sm text-token-sm shadow-sm">
          <summary>
            {t('batchRefreshDetails', {
              updated: lastRefresh.updated,
              unchanged: lastRefresh.unchanged,
              failed: lastRefresh.failed,
            })}
          </summary>
          <ul className="mt-token-sm space-y-token-xs">
            {lastRefresh.results.map((r) => (
              <li key={r.documentId}>
                {r.internalId}: {r.outcome}
                {r.previousStatus && r.status && r.previousStatus !== r.status
                  ? ` (${r.previousStatus} → ${r.status})`
                  : r.status
                    ? ` (${r.status})`
                    : ''}
                {r.reason ? ` — ${r.reason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {lastCancel ? (
        <details className="rounded-lg border border-border bg-surface px-token-md py-token-sm text-token-sm shadow-sm">
          <summary>
            {t('batchCancelDetails', {
              cancelled: lastCancel.cancelled,
              skipped: lastCancel.skipped,
              failed: lastCancel.failed,
            })}
          </summary>
          <ul className="mt-token-sm space-y-token-xs">
            {lastCancel.results.map((r) => (
              <li key={r.documentId}>
                {r.internalId ?? r.documentId}: {r.outcome}
                {r.reason ? ` (${r.reason})` : ''}
                {r.status ? ` → ${r.status}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!listReady ? (
        <div data-testid="documents-loading" className="space-y-token-sm" aria-busy="true">
          <Skeleton variant="rect" className="h-token-xl" />
          <Skeleton variant="rect" className="h-[12rem]" />
        </div>
      ) : items.length === 0 ? (
        <div data-testid="documents-empty">
          <EmptyState
            title={filtersActive ? t('emptyFiltered') : t('empty')}
            action={{
              label: filtersActive ? t('retryLoad') : t('new'),
              onClick: () => {
                if (filtersActive) resetFilters();
                else router.push(`/${locale}/documents/new`);
              },
            }}
          />
        </div>
      ) : (
        <TableWrap data-testid="documents-table">
          <table className="w-full min-w-[72rem] border-collapse text-start text-token-sm">
            <caption className="sr-only">{t('listCaption')}</caption>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    className="h-token-sm w-token-sm rounded-sm border-border-strong text-brand focus-visible:shadow-ring focus-visible:outline-none"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('selectAllMatching')}
                  />
                </Th>
                <Th>
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('internalId')}>
                    {t('colInvoice')}
                    {sortIndicator('internalId')}
                  </button>
                </Th>
                <Th>{t('colEtaId')}</Th>
                <Th>{t('colType')}</Th>
                <Th>
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('issueDateTime')}>
                    {t('colIssueDate')}
                    {sortIndicator('issueDateTime')}
                  </button>
                </Th>
                <Th>
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('receiverName')}>
                    {t('colReceiver')}
                    {sortIndicator('receiverName')}
                  </button>
                </Th>
                <Th>{t('colReceiverTax')}</Th>
                <Th align="end">
                  <button type="button" className="hover:text-brand" onClick={() => toggleSort('totalAmount')}>
                    {t('colAmount')}
                    {sortIndicator('totalAmount')}
                  </button>
                </Th>
                <Th>{t('colCurrency')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th>{t('colSource')}</Th>
                <Th>{t('colActions')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => {
                const displayStatus = resolveDocumentStatus(doc.status, doc.etaStatus);
                const late =
                  isSigned(doc.status) &&
                  doc.origin !== 'ETA_SYNC' &&
                  Boolean(doc.issueDateTime) &&
                  checkLateSubmission(doc.issueDateTime).isLate;
                const etaId = doc.etaLongId || doc.etaUuid || '';
                return (
                  <tr key={doc.id} className="hover:bg-surface-alt">
                    <Td>
                      <input
                        type="checkbox"
                        className="h-token-sm w-token-sm rounded-sm border-border-strong text-brand focus-visible:shadow-ring focus-visible:outline-none"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleOne(doc.id)}
                        aria-label={t('selectRow', { internalId: doc.internalId })}
                      />
                    </Td>
                    <Td>
                      <Link
                        href={`/${locale}/documents/${doc.id}`}
                        className="font-en font-medium text-brand hover:underline"
                        dir="ltr"
                      >
                        {doc.internalId}
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
                    <Td>{kindLabel(doc.kind)}</Td>
                    <Td>
                      <span dir="ltr" className="font-en tabular-nums">
                        {formatIssueDate(doc.issueDateTime)}
                      </span>
                    </Td>
                    <Td className="font-medium">{doc.receiverName || '—'}</Td>
                    <Td>
                      <span dir="ltr" className="font-en tabular-nums">
                        {doc.receiverId || '—'}
                      </span>
                    </Td>
                    <Td align="end">
                      <span dir="ltr" className="font-en tabular-nums">
                        {formatMoneyDisplay(doc.totalAmount)}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-en">
                        {doc.currencyCode || '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-token-xs">
                        <DocumentStatusBadge status={displayStatus} label={statusLabel(displayStatus)} />
                        {late ? (
                          <Badge variant="warning">{t('lateBadge')}</Badge>
                        ) : null}
                        {doc.needsAttention ? (
                          <span className="text-token-xs text-warning">{t('needsAttention')}</span>
                        ) : null}
                      </span>
                    </Td>
                    <Td>
                      {doc.origin === 'ETA_SYNC' ? (
                        <Badge variant="warning">{t('importedBadge')}</Badge>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <DropdownMenu
                        label={t('actionsMenu')}
                        items={[
                          {
                            id: 'view',
                            label: t('view'),
                            onSelect: () => router.push(`/${locale}/documents/${doc.id}`),
                          },
                          {
                            id: 'preview',
                            label: t('previewPrint'),
                            onSelect: () => setPreviewId(doc.id),
                          },
                          ...(isSigned(doc.status) && doc.origin !== 'ETA_SYNC'
                            ? [
                                {
                                  id: 'submit',
                                  label: t('submitOne'),
                                  onSelect: () => void runSubmitOne(doc.id),
                                },
                              ]
                            : []),
                          ...(isPendingEta(doc.status, doc.etaUuid) ||
                          doc.status === 'VALID' ||
                          doc.status === 'INVALID'
                            ? [
                                {
                                  id: 'refresh',
                                  label: t('refreshStatus'),
                                  onSelect: () => void runRefreshOne(doc.id),
                                },
                              ]
                            : []),
                          ...(canDownloadEta(doc.status, doc.etaUuid)
                            ? [
                                {
                                  id: 'printout',
                                  label: t('downloadPrintout'),
                                  onSelect: () => void runDownloadPrintout(doc.id),
                                },
                              ]
                            : []),
                          ...(canCreateReturnCreditNote(
                            doc.kind,
                            resolveDocumentStatus(doc.status, doc.etaStatus),
                            doc.etaUuid,
                          )
                            ? [
                                {
                                  id: 'return',
                                  label: t('returnCreditNote'),
                                  onSelect: () => void runReturnOne(doc.id),
                                },
                              ]
                            : []),
                          ...(canCancel(doc.status, doc.etaUuid)
                            ? [
                                {
                                  id: 'cancel',
                                  label: t('cancelDocument'),
                                  danger: true,
                                  onSelect: () => void runCancelOne(doc.id),
                                },
                              ]
                            : []),
                          ...(canEditDocument(
                            doc.origin,
                            resolveDocumentStatus(doc.status, doc.etaStatus),
                          )
                            ? [
                                {
                                  id: 'delete',
                                  label: t('delete'),
                                  danger: true,
                                  onSelect: () => {
                                    void (async () => {
                                      await deleteDocument(doc.id);
                                      setSelected((prev) => {
                                        const next = new Set(prev);
                                        next.delete(doc.id);
                                        return next;
                                      });
                                      await reload();
                                    })();
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
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

      <ConfirmDialog
        open={Boolean(lateConfirm)}
        title={t('title')}
        description={
          lateConfirm
            ? t('lateSubmitConfirm', {
                count: lateConfirm.count,
                days: lateConfirm.days,
              })
            : undefined
        }
        onClose={() => {
          lateConfirm?.resolve(false);
          setLateConfirm(null);
        }}
        onConfirm={() => {
          lateConfirm?.resolve(true);
          setLateConfirm(null);
        }}
      />

      <CancelReasonDialog
        open={Boolean(cancelTarget)}
        loading={busy}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) void executeCancel(target.ids, reason, target.batch);
        }}
      />

      <LocalPdfPreviewModal
        open={Boolean(previewId)}
        title={t('previewPrint')}
        closeLabel={t('close')}
        downloadLabel={t('downloadPdf')}
        loadingLabel={t('previewLoading')}
        errorFallback={t('downloadFailed')}
        onClose={() => setPreviewId(null)}
        loadPdf={() =>
          downloadLocalPrintout(previewId!, locale === 'ar' ? 'ar' : 'en')
        }
      />
    </div>
  );
}
