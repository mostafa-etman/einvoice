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
  IMPORT_FIELD_AR,
  IMPORT_REQUIRED_FIELDS,
} from '@/lib/imports/import-columns';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { FileDropzone } from './_components/file-dropzone';
import { JobStatusBadge } from './_components/job-status-badge';

const STUCK_STATUSES = new Set(['VALIDATING', 'RUNNING']);

const DOCUMENT_TYPES = [
  { value: 'I', key: 'typeI' },
  { value: 'C', key: 'typeC' },
  { value: 'D', key: 'typeD' },
  { value: 'EI', key: 'typeEI' },
  { value: 'EC', key: 'typeEC' },
  { value: 'ED', key: 'typeED' },
] as const;

export default function ImportsPage() {
  const t = useTranslations('imports');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
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
    return listImportJobs()
      .then((r) => {
        setJobs(r.items);
        setListFailed(false);
      })
      .catch((e: Error) => {
        setListFailed(true);
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setJobs([]);
      setBranches([]);
      setBranchId('');
      setJobsLoading(false);
      return;
    }
    setBranches([]);
    setBranchId('');
    setJobsLoading(true);
    void reloadJobs().finally(() => setJobsLoading(false));
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
      setListFailed(false);
      setError(e instanceof Error ? e.message : t('uploadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveMappingAndValidate = async () => {
    if (!active) return;
    const missing = IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]?.trim());
    if (missing.length) {
      setListFailed(false);
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
      setListFailed(false);
      setError(e instanceof Error ? e.message : t('validateFailed'));
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
      setListFailed(false);
      setError(e instanceof Error ? e.message : t('runFailed'));
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

  const jobColumns: TableColumn<ImportJob>[] = [
    {
      id: 'file',
      header: t('sourceFile'),
      cell: (j) => (
        <button
          type="button"
          className="text-start text-token-sm text-brand underline"
          onClick={() => void refreshActive(j.id)}
        >
          <span className="font-en" dir="ltr">
            {j.sourceFileName}
          </span>
        </button>
      ),
    },
    {
      id: 'status',
      header: t('status'),
      cell: (j) => <JobStatusBadge status={j.status} />,
    },
    {
      id: 'rows',
      header: t('validRows'),
      cell: (j) => (
        <span className="font-en tabular-nums" dir="ltr">
          {j.validRows}/{j.totalRows}
        </span>
      ),
    },
    {
      id: 'id',
      header: '',
      align: 'end',
      cell: (j) => (
        <Link
          href={`/${locale}/imports`}
          className="font-en text-token-xs text-foreground-subtle"
        >
          <span dir="ltr">{j.id.slice(0, 8)}</span>
        </Link>
      ),
    },
  ];

  const rowColumns: TableColumn<ImportRow>[] = [
    {
      id: 'row',
      header: t('row'),
      cell: (r) => (
        <span className="font-en tabular-nums" dir="ltr">
          {r.rowNumber}
        </span>
      ),
    },
    {
      id: 'key',
      header: t('invoiceKey'),
      cell: (r) => (
        <span className="font-en" dir="ltr">
          {r.businessKey ?? ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('status'),
      cell: (r) => <JobStatusBadge status={r.status} />,
    },
    {
      id: 'message',
      header: t('message'),
      cell: (r) =>
        Array.isArray(r.errorsJson)
          ? r.errorsJson.map((e) => e.message).join('; ')
          : '',
    },
  ];

  return (
    <div className="space-y-token-lg" aria-busy={busy || jobsLoading || undefined}>
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
        subtitle={t('intro')}
      />

      {error ? (
        <Card className="border-danger" role="alert">
          <p className="m-0 text-token-sm text-danger">{error}</p>
          {listFailed ? (
            <Button
              className="mt-token-sm"
              variant="secondary"
              size="sm"
              onClick={() => {
                setError(null);
                setListFailed(false);
                setJobsLoading(true);
                void reloadJobs().finally(() => setJobsLoading(false));
              }}
            >
              {t('retryLoad')}
            </Button>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('start')}</CardTitle>
            <CardDescription>{t('templateHelp')}</CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-token-md sm:grid-cols-2">
          <Select
            label={t('documentType')}
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          >
            {DOCUMENT_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.key)}
              </option>
            ))}
          </Select>
          <Select
            label={t('branch')}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? ` (${t('defaultBranch')})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-token-md flex flex-wrap gap-token-sm">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              const blob = await downloadImportTemplate(documentType, 'csv');
              downloadBlob(blob, `import-template-${documentType}.csv`);
            }}
          >
            {t('downloadTemplate')} ({t('csv')})
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              const blob = await downloadImportTemplate(documentType, 'xlsx');
              downloadBlob(blob, `import-template-${documentType}.xlsx`);
            }}
          >
            {t('downloadTemplate')} ({t('xlsx')})
          </Button>
        </div>
        <div className="mt-token-md">
          <FileDropzone
            disabled={busy}
            busy={busy}
            label={t('upload')}
            hint={t('dropHint')}
            typesHint={t('fileTypesHint')}
            onFile={(file) => void onUpload(file)}
          />
        </div>
      </Card>

      {active ? (
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>
                <span className="font-en break-all" dir="ltr">
                  {active.sourceFileName}
                </span>
              </CardTitle>
              <div className="mt-token-sm flex flex-wrap items-center gap-token-sm">
                <JobStatusBadge status={active.status} />
                <span className="font-en text-token-xs text-foreground-muted" dir="ltr">
                  {active.documentType}
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refreshActive(active.id)}
            >
              {t('refresh')}
            </Button>
          </CardHeader>

          {stuckHint ? (
            <p className="text-token-sm text-danger" role="alert">
              {t('stuckHint')}
            </p>
          ) : null}

          <h3 className="m-0 text-token-sm font-semibold text-foreground">{t('mapping')}</h3>
          <p className="mt-token-xs text-token-xs text-foreground-muted">{t('mappingHelp')}</p>
          <div className="mt-token-sm grid gap-token-sm md:grid-cols-2">
            {mappingFields.map((field) => (
              <Input
                key={field}
                label={
                  <>
                    {t('targetField')}:{' '}
                    <span className="font-en" dir="ltr">
                      {field}
                    </span>
                    {IMPORT_FIELD_AR[field] ? ` — ${IMPORT_FIELD_AR[field]}` : ''}
                    {(IMPORT_REQUIRED_FIELDS as readonly string[]).includes(field) ? (
                      <span className="text-danger"> *</span>
                    ) : null}
                  </>
                }
                value={mapping[field] ?? ''}
                placeholder={t('sourceColumn')}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [field]: e.target.value }))
                }
              />
            ))}
          </div>
          <Button
            type="button"
            variant="link"
            className="mt-token-sm"
            onClick={() => setShowOptionalMapping((v) => !v)}
          >
            {showOptionalMapping ? t('hideOptionalMapping') : t('showOptionalMapping')}
          </Button>
          <div className="mt-token-md">
            <Button
              type="button"
              disabled={busy}
              loading={busy}
              onClick={() => void saveMappingAndValidate()}
            >
              {t('validate')}
            </Button>
          </div>

          {(active.validRows > 0 ||
            active.invalidRows > 0 ||
            active.status === 'FAILED') && (
            <div className="mt-token-lg">
              <h3 className="m-0 text-token-sm font-semibold text-foreground">
                {t('validationReport')}
              </h3>
              <p className="mt-token-xs text-token-sm">
                {t('validRows')}:{' '}
                <span className="font-en tabular-nums" dir="ltr">
                  {active.validRows}
                </span>
                {' · '}
                {t('invalidRows')}:{' '}
                <span className="font-en tabular-nums" dir="ltr">
                  {active.invalidRows}
                </span>
                {active.invalidRows > 0 && active.validRows > 0 ? (
                  <span className="ms-token-sm text-brand">
                    {' '}
                    — {t('partialSuccess')}
                  </span>
                ) : null}
              </p>
              {active.errorReportAvailable ? (
                <Button
                  type="button"
                  variant="link"
                  className="mt-token-sm"
                  onClick={async () => {
                    const blob = await downloadImportErrorReport(active.id);
                    downloadBlob(blob, `import-${active.id}-errors.csv`);
                  }}
                >
                  {t('downloadErrors')}
                </Button>
              ) : null}
              <div className="mt-token-md">
                <Table
                  caption={t('rowsCaption')}
                  columns={rowColumns}
                  rows={rows.slice(0, 100)}
                  getRowId={(r) => r.id}
                  dense
                />
              </div>
              {active.status === 'VALIDATED' ? (
                <div className="mt-token-md flex flex-wrap gap-token-sm">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || active.validRows === 0}
                    onClick={() => void run('CREATE_ONLY')}
                  >
                    {t('runCreateOnly')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || active.validRows === 0}
                    onClick={() => void run('CREATE_SIGN_SUBMIT')}
                    title={t('runSignSubmitHelp')}
                  >
                    {t('runSignSubmit')}
                  </Button>
                  <p className="w-full text-token-xs text-foreground-muted">
                    {t('runSignSubmitHelp')}
                  </p>
                </div>
              ) : null}
              {['PARTIAL', 'SUCCEEDED'].includes(active.status) ? (
                <p className="mt-token-md text-token-sm">
                  {t('createdDocs')}:{' '}
                  <span className="font-en tabular-nums" dir="ltr">
                    {active.createdDocs}
                  </span>
                  {active.status === 'PARTIAL' ? ` — ${t('partialSuccess')}` : ''}
                </p>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      <section>
        <h2 className="m-0 mb-token-md text-token-lg font-semibold text-foreground">
          {t('history')}
        </h2>
        {listFailed && !jobsLoading ? null : (
          <Table
            caption={t('listCaption')}
            columns={jobColumns}
            rows={jobs}
            getRowId={(j) => j.id}
            loading={jobsLoading}
            empty={<EmptyState title={t('noJobs')} />}
          />
        )}
      </section>
    </div>
  );
}
