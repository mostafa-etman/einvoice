'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  downloadImportErrorReport,
  downloadImportTemplate,
  getImportJob,
  listImportJobs,
  listImportRows,
  putImportMapping,
  runImportJob,
  uploadImportFile,
  validateImportJob,
  type ImportJob,
  type ImportRow,
} from '@/lib/api/imports';

const REQUIRED = [
  'internalID',
  'dateTimeIssued',
  'receiverName',
  'receiverId',
  'itemCode',
  'quantity',
  'unitPrice',
] as const;

export default function ImportsPage() {
  const t = useTranslations('imports');
  const locale = useLocale();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [active, setActive] = useState<ImportJob | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [documentType, setDocumentType] = useState('I');

  const reloadJobs = useCallback(() => {
    listImportJobs()
      .then((r) => setJobs(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    reloadJobs();
  }, [reloadJobs]);

  const refreshActive = async (id: string) => {
    const job = await getImportJob(id);
    setActive(job);
    setMapping((job.mappingJson as Record<string, string>) || {});
    if (['VALIDATED', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED'].includes(job.status)) {
      const rr = await listImportRows(id);
      setRows(rr.items);
    }
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const job = await uploadImportFile({ file, documentType });
      setActive(job);
      setMapping((job.mappingJson as Record<string, string>) || {});
      reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const saveMappingAndValidate = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await putImportMapping(active.id, mapping);
      await validateImportJob(active.id);
      // poll until validated
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const job = await getImportJob(active.id);
        if (job.status === 'VALIDATED' || job.status === 'FAILED') {
          await refreshActive(job.id);
          break;
        }
      }
      reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validate failed');
    } finally {
      setBusy(false);
    }
  };

  const run = async (runMode: 'CREATE_ONLY' | 'CREATE_SIGN_SUBMIT') => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await runImportJob(active.id, runMode);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const job = await getImportJob(active.id);
        if (['PARTIAL', 'SUCCEEDED', 'FAILED'].includes(job.status)) {
          await refreshActive(job.id);
          break;
        }
      }
      reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
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

      <section className="mt-token-xl flex flex-wrap gap-token-md">
        <label className="text-token-sm">
          {t('documentType')}
          <select
            className="ms-token-sm rounded border border-border bg-background px-token-sm py-token-xs"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          >
            <option value="I">Invoice (I)</option>
            <option value="C">Credit note (C)</option>
            <option value="D">Debit note (D)</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-border px-token-md py-token-xs text-token-sm hover:bg-brand-muted"
          onClick={async () => {
            const blob = await downloadImportTemplate(documentType, 'csv');
            downloadBlob(blob, `import-template-${documentType}.csv`);
          }}
        >
          {t('downloadTemplate')} ({t('csv')})
        </button>
        <button
          type="button"
          className="rounded border border-border px-token-md py-token-xs text-token-sm hover:bg-brand-muted"
          onClick={async () => {
            const blob = await downloadImportTemplate(documentType, 'xlsx');
            downloadBlob(blob, `import-template-${documentType}.xlsx`);
          }}
        >
          {t('downloadTemplate')} ({t('xlsx')})
        </button>
        <label className="rounded bg-brand px-token-md py-token-xs text-token-sm text-white hover:opacity-90">
          {t('upload')}
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={busy}
            onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
          />
        </label>
      </section>

      {active && (
        <section className="mt-token-xl rounded border border-border bg-surface p-token-lg">
          <div className="flex flex-wrap items-center gap-token-md">
            <h2 className="font-display text-token-xl">{active.sourceFileName}</h2>
            <span className="rounded bg-brand-muted px-token-sm py-token-xs text-token-sm">
              {t('status')}: {active.status}
            </span>
            <button
              type="button"
              className="text-token-sm underline"
              onClick={() => void refreshActive(active.id)}
            >
              {t('refresh')}
            </button>
          </div>

          <h3 className="mt-token-lg text-token-md font-medium">{t('mapping')}</h3>
          <div className="mt-token-sm grid gap-token-sm md:grid-cols-2">
            {REQUIRED.map((field) => (
              <label key={field} className="text-token-sm">
                {t('targetField')}: {field}
                <input
                  className="mt-token-xs w-full rounded border border-border bg-background px-token-sm py-token-xs"
                  value={mapping[field] ?? ''}
                  placeholder={t('sourceColumn')}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [field]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-token-md rounded bg-brand px-token-md py-token-xs text-token-sm text-white disabled:opacity-50"
            onClick={() => void saveMappingAndValidate()}
          >
            {t('validate')}
          </button>

          {(active.validRows > 0 || active.invalidRows > 0) && (
            <div className="mt-token-lg">
              <h3 className="text-token-md font-medium">{t('validationReport')}</h3>
              <p className="mt-token-xs text-token-sm">
                {t('validRows')}: {active.validRows} · {t('invalidRows')}:{' '}
                {active.invalidRows}
                {active.invalidRows > 0 && active.validRows > 0 ? (
                  <span className="ms-token-sm text-brand"> — {t('partialSuccess')}</span>
                ) : null}
              </p>
              {active.errorReportAvailable && (
                <button
                  type="button"
                  className="mt-token-sm text-token-sm underline"
                  onClick={async () => {
                    const blob = await downloadImportErrorReport(active.id);
                    downloadBlob(blob, `import-${active.id}-errors.csv`);
                  }}
                >
                  {t('downloadErrors')}
                </button>
              )}
              <div className="mt-token-md max-h-64 overflow-auto rounded border border-border">
                <table className="w-full text-start text-token-sm">
                  <thead className="bg-brand-muted">
                    <tr>
                      <th className="px-token-sm py-token-xs">{t('row')}</th>
                      <th className="px-token-sm py-token-xs">{t('status')}</th>
                      <th className="px-token-sm py-token-xs">{t('message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-token-sm py-token-xs">{r.rowNumber}</td>
                        <td className="px-token-sm py-token-xs">{r.status}</td>
                        <td className="px-token-sm py-token-xs">
                          {Array.isArray(r.errorsJson)
                            ? r.errorsJson.map((e) => e.message).join('; ')
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {active.status === 'VALIDATED' && (
                <div className="mt-token-md flex flex-wrap gap-token-sm">
                  <button
                    type="button"
                    disabled={busy || active.validRows === 0}
                    className="rounded border border-border px-token-md py-token-xs text-token-sm hover:bg-brand-muted disabled:opacity-50"
                    onClick={() => void run('CREATE_ONLY')}
                  >
                    {t('runCreateOnly')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || active.validRows === 0}
                    className="rounded bg-brand px-token-md py-token-xs text-token-sm text-white disabled:opacity-50"
                    onClick={() => void run('CREATE_SIGN_SUBMIT')}
                  >
                    {t('runSignSubmit')}
                  </button>
                </div>
              )}
              {['PARTIAL', 'SUCCEEDED'].includes(active.status) && (
                <p className="mt-token-md text-token-sm">
                  {t('createdDocs')}: {active.createdDocs}
                  {active.status === 'PARTIAL' ? ` — ${t('partialSuccess')}` : ''}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mt-token-xl">
        <h2 className="font-display text-token-xl">{t('history')}</h2>
        {jobs.length === 0 ? (
          <p className="mt-token-sm text-token-sm text-foreground/70">{t('noJobs')}</p>
        ) : (
          <ul className="mt-token-md divide-y divide-border rounded border border-border">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-token-md px-token-md py-token-sm">
                <button
                  type="button"
                  className="text-start text-token-sm text-brand underline"
                  onClick={() => void refreshActive(j.id)}
                >
                  {j.sourceFileName}
                </button>
                <span className="text-token-sm">{j.status}</span>
                <span className="text-token-sm text-foreground/70">
                  {t('validRows')} {j.validRows}/{j.totalRows}
                </span>
                <Link
                  href={`/${locale}/imports`}
                  className="ms-auto text-token-xs text-foreground/50"
                >
                  {j.id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
