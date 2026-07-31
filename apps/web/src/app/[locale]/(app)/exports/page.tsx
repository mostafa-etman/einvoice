'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import {
  createEtaPackageExport,
  createLocalExport,
  downloadExportArtifact,
  getExportJob,
  listExportJobs,
  type ExportJob,
} from '@/lib/api/exports';

export default function ExportsPage() {
  const t = useTranslations('exports');
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formats, setFormats] = useState<Array<'CSV' | 'XLSX' | 'PDF' | 'JSON'>>([
    'CSV',
    'JSON',
  ]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const reload = useCallback(() => {
    listExportJobs()
      .then((r) => setJobs(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleFormat = (f: 'CSV' | 'XLSX' | 'PDF' | 'JSON') => {
    setFormats((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  };

  const pollUntilReady = async (id: string) => {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const job = await getExportJob(id);
      if (['READY', 'FAILED', 'EXPIRED'].includes(job.status)) return job;
    }
    return getExportJob(id);
  };

  const startLocal = async () => {
    setBusy(true);
    setError(null);
    try {
      const job = await createLocalExport({
        formats,
        filters: {
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to).toISOString() : undefined,
        },
      });
      await pollUntilReady(job.id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const startPackage = async () => {
    if (!from || !to) {
      setError('From/To required for ETA package');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job = await createEtaPackageExport({
        dateFrom: new Date(from).toISOString(),
        dateTo: new Date(to).toISOString(),
        type: 'full',
        format: 'JSON',
      });
      await pollUntilReady(job.id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Package request failed');
    } finally {
      setBusy(false);
    }
  };

  const download = async (job: ExportJob, format?: string) => {
    const blob = await downloadExportArtifact(job.id, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      job.kind === 'ETA_PACKAGE'
        ? `eta-package-${job.id}.zip`
        : `export-${job.id}.${format || 'bin'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-5xl px-token-lg py-token-xl">
      <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/80">{t('intro')}</p>

      {error && (
        <p className="mt-token-md rounded border border-danger/40 bg-danger/10 px-token-md py-token-sm text-token-sm text-danger">
          {error}
        </p>
      )}

      <section className="mt-token-xl grid gap-token-lg md:grid-cols-2">
        <div className="rounded border border-border bg-surface p-token-lg">
          <h2 className="font-display text-token-xl">{t('local')}</h2>
          <div className="mt-token-md flex flex-wrap gap-token-sm">
            {(['CSV', 'XLSX', 'PDF', 'JSON'] as const).map((f) => (
              <label key={f} className="flex items-center gap-token-xs text-token-sm">
                <input
                  type="checkbox"
                  checked={formats.includes(f)}
                  onChange={() => toggleFormat(f)}
                />
                {f}
              </label>
            ))}
          </div>
          <div className="mt-token-md grid gap-token-sm sm:grid-cols-2">
            <label className="text-token-sm">
              {t('from')}
              <input
                type="date"
                className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-token-sm">
              {t('to')}
              <input
                type="date"
                className="mt-token-md w-full rounded border border-border bg-background px-token-sm py-token-xs sm:mt-token-xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy || formats.length === 0}
            className="mt-token-md rounded bg-brand px-token-md py-token-xs text-token-sm text-white disabled:opacity-50"
            onClick={() => void startLocal()}
          >
            {t('createLocal')}
          </button>
        </div>

        <div className="rounded border border-border bg-surface p-token-lg">
          <h2 className="font-display text-token-xl">{t('etaPackage')}</h2>
          <p className="mt-token-sm text-token-sm text-foreground/70">
            Request → Get Package Requests → download zip
          </p>
          <button
            type="button"
            disabled={busy || !from || !to}
            className="mt-token-md rounded border border-border px-token-md py-token-xs text-token-sm hover:bg-brand-muted disabled:opacity-50"
            onClick={() => void startPackage()}
          >
            {t('createPackage')}
          </button>
        </div>
      </section>

      <section className="mt-token-xl">
        <div className="flex items-center gap-token-md">
          <h2 className="font-display text-token-xl">{t('history')}</h2>
          <button type="button" className="text-token-sm underline" onClick={reload}>
            {t('refresh')}
          </button>
        </div>
        {jobs.length === 0 ? (
          <p className="mt-token-sm text-token-sm text-foreground/70">{t('noJobs')}</p>
        ) : (
          <ul className="mt-token-md divide-y divide-border rounded border border-border">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-center gap-token-md px-token-md py-token-sm text-token-sm"
              >
                <span>{t('kind')}: {j.kind}</span>
                <span>
                  {t('status')}: {j.status}
                </span>
                {j.etaPackage && (
                  <span>
                    {t('packageStatus')}: {j.etaPackage.localStatus}
                  </span>
                )}
                {j.status === 'READY' && j.kind === 'LOCAL' && (
                  <span className="flex gap-token-sm">
                    {(['csv', 'xlsx', 'pdf', 'json'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className="underline"
                        onClick={() => void download(j, f)}
                      >
                        {t('download')} {f.toUpperCase()}
                      </button>
                    ))}
                  </span>
                )}
                {j.status === 'READY' && j.kind === 'ETA_PACKAGE' && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void download(j)}
                  >
                    {t('download')} ZIP
                  </button>
                )}
                {j.errorSummary && (
                  <span className="text-danger">{j.errorSummary}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
