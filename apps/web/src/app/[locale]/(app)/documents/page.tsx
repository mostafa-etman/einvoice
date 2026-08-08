'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkLateSubmission } from '@einvoice/eta-core';
import { ApiError } from '@/lib/api/client';
import {
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

type DocRow = DocumentListItem;

type SortBy =
  | 'issueDateTime'
  | 'totalAmount'
  | 'internalId'
  | 'receiverName';

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

const AUTO_POLL_MS = 5_000;
const PAGE_SIZE = 50;

function isSigned(status: string) {
  return status === 'SIGNED';
}

function isPendingEta(status: string, etaUuid?: string | null) {
  return status === 'SUBMITTED' || (Boolean(etaUuid) && status === 'SUBMITTED');
}

function canCancel(status: string, etaUuid?: string | null) {
  return Boolean(etaUuid) && (status === 'VALID' || status === 'SUBMITTED');
}

function canDownloadEta(status: string, etaUuid?: string | null) {
  return (
    Boolean(etaUuid) &&
    (status === 'VALID' ||
      status === 'INVALID' ||
      status === 'SUBMITTED' ||
      status === 'CANCELLED' ||
      status === 'REJECTED')
  );
}

function formatIssueDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatAmount(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'VALID':
      return 'bg-green-100 text-green-900';
    case 'INVALID':
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-red-100 text-red-900';
    case 'SUBMITTED':
      return 'bg-blue-100 text-blue-900';
    case 'SIGNED':
      return 'bg-emerald-100 text-emerald-900';
    case 'DRAFT':
      return 'bg-zinc-100 text-zinc-800';
    case 'READY':
    case 'PENDING_SIGNATURE':
      return 'bg-amber-100 text-amber-900';
    default:
      return 'bg-zinc-100 text-zinc-800';
  }
}

export default function DocumentsPage() {
  const t = useTranslations('documents');
  const locale = useLocale();
  const [items, setItems] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'ok' | 'err' | 'info'>('info');
  const [busy, setBusy] = useState(false);
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
    setToast(message);
    setToastTone(tone);
    window.setTimeout(() => setToast(null), 12000);
  };

  const runSalesSync = async () => {
    setSalesSyncing(true);
    setError(null);
    try {
      await syncSales({
        from: syncFrom ? `${syncFrom}T00:00:00.000Z` : undefined,
        to: syncTo ? `${syncTo}T23:59:59.999Z` : undefined,
      });
      setShowSalesSyncReset(true);
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
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
    if (!late.length) return true;
    const sample = late[0]!;
    const check = checkLateSubmission(sample.issueDateTime!);
    return window.confirm(
      t('lateSubmitConfirm', {
        count: late.length,
        days: check.warnDays,
      }),
    );
  };

  const runSendSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirmLateIfNeeded(selectedRows)) return;
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
      return;
    }
    const reason = window.prompt(t('cancelReasonPrompt')) ?? '';
    if (!reason.trim()) {
      setError(t('cancelReasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setLastCancel(null);
    try {
      const result = await cancelDocumentsSelected(ids, reason.trim());
      setLastCancel(result);
      showToast(
        t('batchCancelSummary', {
          cancelled: result.cancelled,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
      setSelected(new Set());
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forbidden'));
    } finally {
      setBusy(false);
    }
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
      setError(e instanceof Error ? e.message : t('refreshStatusFailed'));
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
      setError(e instanceof Error ? e.message : t('refreshStatusFailed'));
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
      setError(e instanceof Error ? e.message : t('refreshStatusFailed'));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t('downloadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const runCancelOne = async (id: string) => {
    const reason = window.prompt(t('cancelReasonPrompt')) ?? '';
    if (!reason.trim()) {
      setError(t('cancelReasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelDocument(id, reason.trim());
      showToast(t('batchCancelSummary', { cancelled: 1, skipped: 0, failed: 0 }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forbidden'));
    } finally {
      setBusy(false);
    }
  };

  const runSubmitOne = async (id: string) => {
    const row = items.find((d) => d.id === id);
    if (!row || !isSigned(row.status) || row.origin === 'ETA_SYNC') return;
    if (!confirmLateIfNeeded([row])) return;
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
      setError(e instanceof Error ? e.message : t('submitFailed'));
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

  const thClass =
    'whitespace-nowrap border-b border-border px-token-sm py-token-sm text-start text-token-xs font-medium text-foreground/70';
  const tdClass = 'border-b border-border px-token-sm py-token-sm text-token-sm';

  return (
    <div className="space-y-token-lg">
      <div className="flex flex-wrap items-center justify-between gap-token-md">
        <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
        <div className="flex flex-wrap items-end gap-token-sm">
          <label className="block text-token-xs">
            {t('salesSyncFrom')}
            <input
              type="date"
              className="mt-1 block border border-border bg-background px-2 py-1"
              value={syncFrom}
              onChange={(e) => setSyncFrom(e.target.value)}
              dir="ltr"
            />
          </label>
          <label className="block text-token-xs">
            {t('salesSyncTo')}
            <input
              type="date"
              className="mt-1 block border border-border bg-background px-2 py-1"
              value={syncTo}
              onChange={(e) => setSyncTo(e.target.value)}
              dir="ltr"
            />
          </label>
          {showSalesSyncReset ? (
            <button
              type="button"
              disabled={salesSyncing || busy}
              className="rounded border border-danger/50 px-token-md py-token-sm text-token-sm text-danger disabled:opacity-50"
              onClick={() => void runResetSalesSync()}
            >
              {t('salesSyncReset')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={salesSyncing || busy}
            className="rounded border border-brand px-token-md py-token-sm text-token-sm text-brand disabled:opacity-50"
            onClick={() => void runSalesSync()}
          >
            {salesSyncing ? t('salesSyncing') : t('salesSync')}
          </button>
          <Link
            href={`/${locale}/documents/new`}
            className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
          >
            {t('new')}
          </Link>
        </div>
      </div>
      <p className="text-token-xs text-foreground/60">{t('salesSyncRangeHint')}</p>

      <div className="grid grid-cols-2 gap-token-sm md:grid-cols-3 lg:grid-cols-6">
        <label className="block text-token-xs">
          {t('filterFrom')}
          <input
            type="date"
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setSelected(new Set());
            }}
            dir="ltr"
          />
        </label>
        <label className="block text-token-xs">
          {t('filterTo')}
          <input
            type="date"
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setSelected(new Set());
            }}
            dir="ltr"
          />
        </label>
        <label className="block text-token-xs">
          {t('filterKind')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value);
              setSelected(new Set());
            }}
          >
            <option value="">{t('filterAll')}</option>
            {(
              [
                'INVOICE',
                'CREDIT_NOTE',
                'DEBIT_NOTE',
                'EXPORT_INVOICE',
                'EXPORT_CREDIT_NOTE',
                'EXPORT_DEBIT_NOTE',
              ] as const
            ).map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-token-xs">
          {t('filterStatus')}
          <select
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setSelected(new Set());
            }}
          >
            <option value="">{t('filterAll')}</option>
            {(
              [
                'DRAFT',
                'READY',
                'PENDING_SIGNATURE',
                'SIGNED',
                'SUBMITTED',
                'VALID',
                'INVALID',
                'CANCELLED',
                'REJECTED',
              ] as const
            ).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-token-xs">
          {t('filterReceiver')}
          <input
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={receiver}
            onChange={(e) => {
              setReceiver(e.target.value);
              setSelected(new Set());
            }}
            placeholder={t('filterReceiver')}
          />
        </label>
        <label className="block text-token-xs">
          {t('filterSearch')}
          <input
            className="mt-1 w-full border border-border bg-background px-2 py-1"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(new Set());
            }}
            placeholder={t('filterSearch')}
          />
        </label>
      </div>

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-token-sm rounded border border-border bg-background/60 px-token-md py-token-sm">
          <label className="inline-flex items-center gap-token-xs text-token-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label={t('selectAllMatching')}
            />
            {t('selectAllMatching')}
            {selectedCount ? (
              <span className="text-foreground/60">
                ({t('selectedCount', { count: selectedCount })})
              </span>
            ) : null}
          </label>
          <div className="ms-auto flex flex-wrap gap-token-xs">
            <button
              type="button"
              disabled={busy || selectedCount === 0}
              className="rounded bg-brand px-token-md py-token-xs text-token-sm text-white disabled:opacity-50"
              onClick={() => void runSendSelected()}
            >
              {busy ? t('submitting') : t('sendSelected')}
            </button>
            <button
              type="button"
              disabled={busy || selectedCount === 0}
              className="rounded border border-border px-token-md py-token-xs text-token-sm disabled:opacity-50"
              onClick={() => void runRefreshSelected()}
            >
              {t('refreshSelected')}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded border border-border px-token-md py-token-xs text-token-sm disabled:opacity-50"
              onClick={() => void runRefreshPending()}
            >
              {t('refreshAllPending')}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !selectedRows.some((d) => canCancel(d.status, d.etaUuid))
              }
              className="rounded border border-danger/40 px-token-md py-token-xs text-token-sm text-danger disabled:opacity-50"
              onClick={() => void runCancelSelected()}
            >
              {t('cancelSelected')}
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <p
          className={
            toastTone === 'ok'
              ? 'rounded border-2 border-green-600 bg-green-50 px-token-md py-token-md text-token-sm font-medium text-green-900'
              : toastTone === 'err'
                ? 'rounded border-2 border-danger bg-danger/10 px-token-md py-token-md text-token-sm font-medium text-danger'
                : 'rounded border-2 border-brand bg-brand/10 px-token-md py-token-md text-token-sm font-medium'
          }
          role="status"
        >
          {toast}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded border-2 border-danger bg-danger/10 px-token-md py-token-md text-token-sm font-medium text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {lastBatch ? (
        <details className="rounded border border-border px-token-md py-token-sm text-token-sm">
          <summary>
            {t('batchSendDetails', {
              sent: lastBatch.sent,
              skipped: lastBatch.skipped,
              failed: lastBatch.failed,
            })}
          </summary>
          {lastBatch.lateWarnings?.length ? (
            <p className="mt-token-sm text-amber-800">
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
        <details className="rounded border border-border px-token-md py-token-sm text-token-sm">
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
        <details className="rounded border border-border px-token-md py-token-sm text-token-sm">
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

      {items.length === 0 ? (
        <p className="text-foreground/70">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="min-w-full border-collapse text-start">
            <thead className="bg-background/80">
              <tr>
                <th className={thClass}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('selectAllMatching')}
                  />
                </th>
                <th className={thClass}>
                  <button
                    type="button"
                    className="hover:text-brand"
                    onClick={() => toggleSort('internalId')}
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
                    onClick={() => toggleSort('issueDateTime')}
                  >
                    {t('colIssueDate')}
                    {sortIndicator('issueDateTime')}
                  </button>
                </th>
                <th className={thClass}>
                  <button
                    type="button"
                    className="hover:text-brand"
                    onClick={() => toggleSort('receiverName')}
                  >
                    {t('colReceiver')}
                    {sortIndicator('receiverName')}
                  </button>
                </th>
                <th className={thClass}>{t('colReceiverTax')}</th>
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
                <th className={thClass}>{t('colSource')}</th>
                <th className={thClass}>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.id} className="hover:bg-brand/5">
                  <td className={tdClass}>
                    <input
                      type="checkbox"
                      checked={selected.has(doc.id)}
                      onChange={() => toggleOne(doc.id)}
                      aria-label={t('selectRow', {
                        internalId: doc.internalId,
                      })}
                    />
                  </td>
                  <td className={tdClass}>
                    <Link
                      href={`/${locale}/documents/${doc.id}`}
                      className="font-medium text-brand hover:underline"
                      dir="ltr"
                    >
                      {doc.internalId}
                    </Link>
                  </td>
                  <td className={`${tdClass} max-w-[14rem]`}>
                    <span
                      className="block truncate font-mono text-token-xs"
                      dir="ltr"
                      title={doc.etaLongId || doc.etaUuid || undefined}
                    >
                      {doc.etaLongId || doc.etaUuid || '—'}
                    </span>
                  </td>
                  <td className={tdClass}>{kindLabel(doc.kind)}</td>
                  <td className={tdClass}>
                    <span dir="ltr" className="tabular-nums">
                      {formatIssueDate(doc.issueDateTime)}
                    </span>
                  </td>
                  <td className={tdClass}>{doc.receiverName || '—'}</td>
                  <td className={tdClass}>
                    <span dir="ltr" className="tabular-nums">
                      {doc.receiverId || '—'}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span dir="ltr" className="tabular-nums">
                      {formatAmount(doc.totalAmount)}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span dir="ltr">{doc.currencyCode || '—'}</span>
                  </td>
                  <td className={tdClass}>
                    <span
                      className={`inline-block rounded px-token-xs text-token-xs ${statusBadgeClass(doc.status)}`}
                    >
                      {statusLabel(doc.status)}
                    </span>
                    {doc.needsAttention ? (
                      <span className="ms-token-xs text-token-xs text-amber-800">
                        {t('needsAttention')}
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>
                    {doc.origin === 'ETA_SYNC' ? (
                      <span className="rounded bg-amber-100 px-token-xs text-token-xs text-amber-900">
                        {t('importedBadge')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap gap-token-xs">
                      <Link
                        href={`/${locale}/documents/${doc.id}`}
                        className="text-token-xs text-brand hover:underline"
                      >
                        {t('view')}
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-token-xs text-brand disabled:opacity-50"
                        onClick={() => setPreviewId(doc.id)}
                      >
                        {t('previewPrint')}
                      </button>
                      {isSigned(doc.status) && doc.origin !== 'ETA_SYNC' ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-token-xs text-brand disabled:opacity-50"
                          onClick={() => void runSubmitOne(doc.id)}
                        >
                          {t('submitOne')}
                        </button>
                      ) : null}
                      {isPendingEta(doc.status, doc.etaUuid) ||
                      doc.status === 'VALID' ||
                      doc.status === 'INVALID' ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-token-xs text-brand disabled:opacity-50"
                          onClick={() => void runRefreshOne(doc.id)}
                        >
                          {t('refreshStatus')}
                        </button>
                      ) : null}
                      {canDownloadEta(doc.status, doc.etaUuid) ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-token-xs text-brand disabled:opacity-50"
                          onClick={() => void runDownloadPrintout(doc.id)}
                        >
                          {t('downloadPrintout')}
                        </button>
                      ) : null}
                      {canCancel(doc.status, doc.etaUuid) ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-token-xs text-danger disabled:opacity-50"
                          onClick={() => void runCancelOne(doc.id)}
                        >
                          {t('cancelDocument')}
                        </button>
                      ) : null}
                      {doc.origin !== 'ETA_SYNC' &&
                      (doc.status === 'DRAFT' ||
                        doc.status === 'READY' ||
                        doc.status === 'SIGNED') ? (
                        <button
                          type="button"
                          className="text-token-xs text-danger disabled:opacity-50"
                          disabled={busy}
                          onClick={async () => {
                            await deleteDocument(doc.id);
                            setSelected((prev) => {
                              const next = new Set(prev);
                              next.delete(doc.id);
                              return next;
                            });
                            await reload();
                          }}
                        >
                          {t('delete')}
                        </button>
                      ) : null}
                    </div>
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
