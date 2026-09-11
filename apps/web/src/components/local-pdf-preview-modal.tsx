'use client';

import { useEffect, useRef, useState } from 'react';
import { triggerBrowserDownload } from '@/lib/api/submissions';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={!blob}
            onClick={() => {
              if (blob) triggerBrowserDownload(blob, filename);
            }}
          >
            {downloadLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {closeLabel}
          </Button>
        </>
      }
    >
      <div className="h-[70vh] min-h-0 overflow-hidden bg-background">
        {loading ? (
          <p
            className="p-token-md text-token-sm text-foreground-muted"
            role="status"
            aria-busy="true"
          >
            {loadingLabel}
          </p>
        ) : error ? (
          <p className="p-token-md text-token-sm text-danger" role="alert">
            {error}
          </p>
        ) : url ? (
          <iframe title={title} src={url} className="h-full w-full border-0" />
        ) : null}
      </div>
    </Modal>
  );
}
