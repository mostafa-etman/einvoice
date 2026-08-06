'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkLateSubmission } from '@einvoice/eta-core';
import { deleteDocument, listDocuments } from '@/lib/api/documents';
import {
  cancelDocument,
  cancelDocumentsSelected,
  createSubmission,
  downloadDocumentEtaSource,
  downloadDocumentPrintout,
  refreshDocumentStatus,
  refreshDocumentsStatus,
  triggerBrowserDownload,
  type BatchSubmitResult,
  type StatusRefreshBatchResult,
} from '@/lib/api/submissions';
import { ApiError } from '@/lib/api/client';

type DocRow = {
  id: string;
  kind: string;
  status: string;
  internalId: string;
  totalAmount: string;
  issueDateTime?: string | null;
  needsAttention?: boolean;
  etaUuid?: string | null;
  etaStatus?: string | null;
  etaStatusUpdatedAt?: string | null;
  submissionUuid?: string | null;
  submitInFlight?: boolean;
  submitCooldownUntil?: string | null;
};

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

const AUTO_POLL_MS = 60_000;

function isSigned(status: string) {
  return status === 'SIGNED';
}

function isPendingEta(status: string, etaUuid?: string | null) {
  return status === 'SUBMITTED' && Boolean(etaUuid);
}

function canCancel(status: string, etaUuid?: string | null) {
  return (
    Boolean(etaUuid) && (status === 'VALID' || status === 'SUBMITTED')
  );
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

function formatCheckedAt(
  iso: string | null | undefined,
  locale: string,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(locale);
}

export default function DocumentsPage() {
  const t = useTranslations('documents');
  const locale = useLocale();
  const [items, setItems] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [lastBatch, setLastBatch] = useState<BatchSubmitResult | null>(null);
  const [lastRefresh, setLastRefresh] = useState<StatusRefreshBatchResult | null>(
    null,
  );
  const [lastCancel, setLastCancel] = useState<CancelBatchResult | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await listDocuments({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
      });
      setItems(
        (res.items as Array<Record<string, unknown>>).map((d) => ({
          id: String(d.id),
          kind: String(d.kind),
          status: String(d.status),
          internalId: String(d.internalId),
          totalAmount: String(d.totalAmount ?? ''),
          issueDateTime: d.issueDateTime ? String(d.issueDateTime) : null,
          needsAttention: Boolean(d.needsAttention),
          etaUuid: (d.etaUuid as string | null) ?? null,
          etaStatus: (d.etaStatus as string | null) ?? null,
          etaStatusUpdatedAt: d.etaStatusUpdatedAt
            ? String(d.etaStatusUpdatedAt)
            : null,
          submissionUuid: (d.submissionUuid as string | null) ?? null,
          submitInFlight: Boolean(d.submitInFlight),
          submitCooldownUntil: d.submitCooldownUntil
            ? String(d.submitCooldownUntil)
            : null,
        })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('forbidden'));
    }
  }, [kindFilter, statusFilter, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 8000);
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

  const runDownloadSource = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadDocumentEtaSource(id);
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

  return (
    <div className="space-y-token-lg">
      <div className="flex flex-wrap items-center justify-between gap-token-md">
        <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
        <Link
          href={`/${locale}/documents/new`}
          className="rounded bg-brand px-token-md py-token-sm text-token-sm text-white"
        >
          {t('new')}
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-token-sm">
        <label className="block text-token-sm">
          {t('status')}
          <select
            className="mt-token-xs block rounded border border-border bg-background px-token-sm py-token-xs"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setSelected(new Set());
            }}
          >
            <option value="">{t('filterAll')}</option>
            {[
              'DRAFT',
              'READY',
              'PENDING_SIGNATURE',
              'SIGNED',
              'SUBMITTED',
              'VALID',
              'INVALID',
              'CANCELLED',
              'REJECTED',
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-token-sm">
          {t('kind')}
          <select
            className="mt-token-xs block rounded border border-border bg-background px-token-sm py-token-xs"
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value);
              setSelected(new Set());
            }}
          >
            <option value="">{t('filterAll')}</option>
            {[
              'INVOICE',
              'CREDIT_NOTE',
              'DEBIT_NOTE',
              'EXPORT_INVOICE',
              'EXPORT_CREDIT_NOTE',
              'EXPORT_DEBIT_NOTE',
            ].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
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
          className="rounded border border-border bg-background px-token-md py-token-sm text-token-sm"
          role="status"
        >
          {toast}
        </p>
      ) : null}
      {error ? <p className="text-token-sm text-danger">{error}</p> : null}

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
        <ul className="divide-y divide-border border border-border">
          {items.map((doc) => {
            const checkedAt = formatCheckedAt(doc.etaStatusUpdatedAt, locale);
            return (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-token-md px-token-md py-token-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.has(doc.id)}
                  onChange={() => toggleOne(doc.id)}
                  aria-label={t('selectRow', { internalId: doc.internalId })}
                />
                <Link
                  href={`/${locale}/documents/${doc.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  {doc.internalId}
                </Link>
                <span className="text-token-sm text-foreground/70">{doc.kind}</span>
                <span className="text-token-sm">
                  {doc.status}
                  {doc.etaStatus ? (
                    <span className="text-foreground/60"> · {doc.etaStatus}</span>
                  ) : null}
                </span>
                {doc.needsAttention ? (
                  <span className="text-token-xs text-amber-800">
                    {t('needsAttention')}
                  </span>
                ) : null}
                {checkedAt ? (
                  <span className="text-token-xs text-foreground/50">
                    {t('lastChecked', { when: checkedAt })}
                  </span>
                ) : null}
                <span className="ms-auto text-token-sm">{doc.totalAmount}</span>
                {isPendingEta(doc.status, doc.etaUuid) ||
                doc.status === 'VALID' ||
                doc.status === 'INVALID' ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-token-sm text-brand disabled:opacity-50"
                    onClick={() => void runRefreshOne(doc.id)}
                  >
                    {t('refreshStatus')}
                  </button>
                ) : null}
                {canDownloadEta(doc.status, doc.etaUuid) ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-token-sm text-brand disabled:opacity-50"
                      onClick={() => void runDownloadPrintout(doc.id)}
                    >
                      {t('downloadPrintout')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-token-sm text-brand disabled:opacity-50"
                      onClick={() => void runDownloadSource(doc.id)}
                    >
                      {t('downloadEtaSource')}
                    </button>
                  </>
                ) : null}
                {canCancel(doc.status, doc.etaUuid) ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-token-sm text-danger disabled:opacity-50"
                    onClick={() => void runCancelOne(doc.id)}
                  >
                    {t('cancelDocument')}
                  </button>
                ) : null}
                {isSigned(doc.status) ? (
                  <span className="text-token-xs text-foreground/50">
                    {t('eligibleToSend')}
                    {doc.issueDateTime &&
                    checkLateSubmission(doc.issueDateTime).isLate
                      ? ` · ${t('lateBadge')}`
                      : ''}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="text-token-sm text-danger"
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
