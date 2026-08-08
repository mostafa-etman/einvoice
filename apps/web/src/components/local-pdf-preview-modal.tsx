'use client';

import { useEffect, useRef, useState } from 'react';
import { triggerBrowserDownload } from '@/lib/api/submissions';

type Props = {
  open: boolean;
  title: string;
  closeLabel: string;
  downloadLabel: string;
  loadingLabel: string;
  errorFallback: string;
  onClose: () => void;
  loadPdf: () => Promise<{ blob: Blob; filename: string }>;
};

/**
 * On-screen preview of the same local-printout PDF the download uses.
 * Renders via blob URL in an iframe so Arabic/taxes match the printable file exactly.
 */
export function LocalPdfPreviewModal({
  open,
  title,
  closeLabel,
  downloadLabel,
  loadingLabel,
  errorFallback,
  onClose,
  loadPdf,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState('preview.pdf');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(loadPdf);
  loadRef.current = loadPdf;
  const errorFallbackRef = useRef(errorFallback);
  errorFallbackRef.current = errorFallback;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setUrl(null);
    setBlob(null);
    void (async () => {
      try {
        const result = await loadRef.current();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(result.blob);
        setBlob(result.blob);
        setFilename(result.filename);
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : errorFallbackRef.current,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-token-md"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-token-sm border-b border-border px-token-md py-token-sm">
          <h2 className="font-medium text-brand">{title}</h2>
          <div className="flex flex-wrap gap-token-sm">
            <button
              type="button"
              className="rounded border border-border px-token-sm py-token-xs text-token-sm disabled:opacity-50"
              disabled={!blob}
              onClick={() => {
                if (blob) triggerBrowserDownload(blob, filename);
              }}
            >
              {downloadLabel}
            </button>
            <button
              type="button"
              className="rounded border border-border px-token-sm py-token-xs text-token-sm"
              onClick={onClose}
            >
              {closeLabel}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-background">
          {loading ? (
            <p className="p-token-md text-token-sm text-foreground/70">{loadingLabel}</p>
          ) : error ? (
            <p className="p-token-md text-token-sm text-danger">{error}</p>
          ) : url ? (
            <iframe
              title={title}
              src={url}
              className="h-full w-full border-0"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
