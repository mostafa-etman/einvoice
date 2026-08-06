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
import { listBranches, type Branch } from '@/lib/api/branches';
import {
  IMPORT_COMMON_OPTIONAL_FIELDS,
  IMPORT_REQUIRED_FIELDS,
} from '@/lib/imports/import-columns';
import { useTenant } from '@/lib/tenant-provider';

const STUCK_STATUSES = new Set(['VALIDATING', 'RUNNING']);

export default function ImportsPage() {
  const t = useTranslations('imports');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [active, setActive] = useState<ImportJob | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [documentType, setDocumentType] = useState('I');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [showOptionalMapping, setShowOptionalMapping] = useState(false);
  const [stuckHint, setStuckHint] = useState(false);

  const reloadJobs = useCallback(() => {
    listImportJobs()
      .then((r) => setJobs(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setJobs([]);
      setBranches([]);
      setBranchId('');
      return;
    }
    setBranches([]);
    setBranchId('');
    reloadJobs();
    listBranches()
      .then((list) => {
        const activeBranches = list.filter((b) => b.isActive);
        setBranches(activeBranches);
        const def = activeBranches.find((b) => b.isDefault) ?? activeBranches[0];
        if (def) setBranchId(def.id);
      })
      .catch(() => undefined);
  }, [reloadJobs, tenantId]);

  const refreshActive = async (id: string) => {
    const job = await getImportJob(id);
    setActive(job);
    setMapping((job.mappingJson as Record<string, string>) || {});
    if (
      [
        'VALIDATED',
        'RUNNING',
        'PARTIAL',
        'SUCCEEDED',
        'FAILED',
        'VALIDATING',
      ].includes(job.status)
    ) {
      const rr = await listImportRows(id);
      setRows(rr.items);
    }
    return job;
  };

  const pollUntil = async (
    id: string,
    done: (status: string) => boolean,
    attempts: number,
    delayMs: number,
  ) => {
    setStuckHint(false);
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      const job = await getImportJob(id);
      if (done(job.status)) {
        await refreshActive(job.id);
        return job;
      }
      if (i >= Math.floor(attempts * 0.6) && STUCK_STATUSES.has(job.status)) {
        setStuckHint(true);
      }
    }
    await refreshActive(id);
    setStuckHint(true);
    return null;
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setStuckHint(false);
    try {
      const job = await uploadImportFile({
        file,
        documentType,
        branchId: branchId || undefined,
      });
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
    const missing = IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]?.trim());
    if (missing.length) {
      setError(t('requiredUnmapped'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putImportMapping(active.id, mapping);
      await validateImportJob(active.id);
      const job = await pollUntil(
        active.id,
        (s) => s === 'VALIDATED' || s === 'FAILED',
        90,
        500,
      );
      if (!job) setError(t('stuckHint'));
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
      const job = await pollUntil(
        active.id,
        (s) => ['PARTIAL', 'SUCCEEDED', 'FAILED'].includes(s),
        120,
        700,
      );
      if (!job) setError(t('stuckHint'));
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

  const mappingFields = showOptionalMapping
    ? [
        ...IMPORT_REQUIRED_FIELDS,
        ...IMPORT_COMMON_OPTIONAL_FIELDS.filter(
          (f) =>
            !(IMPORT_REQUIRED_FIELDS as readonly string[]).includes(f),
        ),
      ]
    : [...IMPORT_REQUIRED_FIELDS];

  return (
    <main className="mx-auto max-w-5xl px-token-lg py-token-xl">
      <h1 className="font-display text-token-2xl text-brand">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/80">{t('intro')}</p>
      <p className="mt-token-xs text-token-sm text-foreground/70">
        {t('templateHelp')}
      </p>

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
            <option value="EI">Export invoice (EI)</option>
            <option value="EC">Export credit (EC)</option>
            <option value="ED">Export debit (ED)</option>
          </select>
        </label>
        <label className="text-token-sm">
          {t('branch')}
          <select
            className="ms-token-sm rounded border border-border bg-background px-token-sm py-token-xs"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? ` (${t('defaultBranch')})` : ''}
              </option>
            ))}
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

          {stuckHint ? (
            <p className="mt-token-sm text-token-sm text-danger">{t('stuckHint')}</p>
          ) : null}

          <h3 className="mt-token-lg text-token-md font-medium">{t('mapping')}</h3>
          <p className="mt-token-xs text-token-xs text-foreground/70">
            {t('mappingHelp')}
          </p>
          <div className="mt-token-sm grid gap-token-sm md:grid-cols-2">
            {mappingFields.map((field) => (
              <label key={field} className="text-token-sm">
                {t('targetField')}: {field}
                {(IMPORT_REQUIRED_FIELDS as readonly string[]).includes(field) ? (
                  <span className="text-danger"> *</span>
                ) : null}
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
            className="mt-token-sm text-token-sm text-brand underline"
            onClick={() => setShowOptionalMapping((v) => !v)}
          >
            {showOptionalMapping ? t('hideOptionalMapping') : t('showOptionalMapping')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="mt-token-md block rounded bg-brand px-token-md py-token-xs text-token-sm text-white disabled:opacity-50"
            onClick={() => void saveMappingAndValidate()}
          >
            {t('validate')}
          </button>

          {(active.validRows > 0 ||
            active.invalidRows > 0 ||
            active.status === 'FAILED') && (
            <div className="mt-token-lg">
              <h3 className="text-token-md font-medium">{t('validationReport')}</h3>
              <p className="mt-token-xs text-token-sm">
                {t('validRows')}: {active.validRows} · {t('invalidRows')}:{' '}
                {active.invalidRows}
                {active.invalidRows > 0 && active.validRows > 0 ? (
                  <span className="ms-token-sm text-brand">
                    {' '}
                    — {t('partialSuccess')}
                  </span>
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
                      <th className="px-token-sm py-token-xs">{t('invoiceKey')}</th>
                      <th className="px-token-sm py-token-xs">{t('status')}</th>
                      <th className="px-token-sm py-token-xs">{t('message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-token-sm py-token-xs">{r.rowNumber}</td>
                        <td className="px-token-sm py-token-xs">
                          {r.businessKey ?? ''}
                        </td>
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
                    title={t('runSignSubmitHelp')}
                  >
                    {t('runSignSubmit')}
                  </button>
                  <p className="w-full text-token-xs text-foreground/60">
                    {t('runSignSubmitHelp')}
                  </p>
                </div>
              )}
              {['PARTIAL', 'SUCCEEDED'].includes(active.status) && (
                <p className="mt-token-md text-token-sm">
                  {t('createdDocs')}: {active.createdDocs}
                  {active.status === 'PARTIAL'
                    ? ` — ${t('partialSuccess')}`
                    : ''}
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
              <li
                key={j.id}
                className="flex flex-wrap items-center gap-token-md px-token-md py-token-sm"
              >
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
