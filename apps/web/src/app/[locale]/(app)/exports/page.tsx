'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import {
  createEtaPackageExport,
  createLocalExport,
  downloadExportArtifact,
  getExportJob,
  listExportJobs,
  type ExportJob,
} from '@/lib/api/exports';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Radio } from '@/components/ui/radio';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { JobStatusBadge } from '../imports/_components/job-status-badge';
import { PackageProgress } from './_components/package-progress';
import { useMutationToast } from '@/components/ui/use-mutation-toast';
import { KIND_FILTERS as SALES_DOCUMENT_TYPES } from '../documents/_components/document-list-utils';
import { KIND_FILTERS as PURCHASE_DOCUMENT_TYPES } from '../purchases/_components/purchase-list-utils';
import { cairoExportRangeIso } from './export-date-range';

type DocumentTypeScope = 'all' | 'sales' | 'purchases';

function documentTypesForScope(scope: DocumentTypeScope): string[] {
  if (scope === 'sales') return [...SALES_DOCUMENT_TYPES];
  if (scope === 'purchases') return [...PURCHASE_DOCUMENT_TYPES];
  return [...SALES_DOCUMENT_TYPES, ...PURCHASE_DOCUMENT_TYPES];
}

function localDownloadFormats(job: ExportJob): string[] {
  const requested = (job.formatsJson ?? []).map((f) => String(f).toLowerCase());
  const known = ['csv', 'xlsx', 'pdf', 'json'] as const;
  if (!requested.length) return [...known];
  return known.filter((f) => requested.includes(f));
}

export default function ExportsPage() {
  const t = useTranslations('exports');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const toast = useMutationToast();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [formats, setFormats] = useState<Array<'CSV' | 'XLSX' | 'PDF' | 'JSON'>>([
    'CSV',
    'JSON',
  ]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [documentType, setDocumentType] = useState<DocumentTypeScope>('all');

  const reload = useCallback(() => {
    return listExportJobs()
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
    setJobsLoading(true);
    void reload().finally(() => setJobsLoading(false));
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
          from: from ? cairoExportRangeIso(from, false) : undefined,
          to: to ? cairoExportRangeIso(to, true) : undefined,
          documentTypes: documentTypesForScope(documentType),
        },
      });
      const finished = await pollUntilReady(job.id);
      await reload();
      if (finished.status === 'FAILED') {
        setError(finished.errorSummary || t('exportFailed'));
        toast.error(undefined, finished.errorSummary || t('exportFailed'));
      } else if (finished.status !== 'READY') {
        setError(t('exportFailed'));
        toast.error(undefined, t('exportFailed'));
      } else {
        toast.created();
      }
    } catch (e) {
      setListFailed(false);
      setError(e instanceof Error ? e.message : t('exportFailed'));
      toast.error(e, t('exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  const startPackage = async () => {
    if (!from || !to) {
      setListFailed(false);
      setError(t('rangeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const job = await createEtaPackageExport({
        dateFrom: new Date(from).toISOString(),
        dateTo: new Date(`${to}T23:59:59`).toISOString(),
        type: 'full',
        format: 'JSON',
      });
      const finished = await pollUntilReady(job.id);
      if (finished.status === 'FAILED' && finished.errorSummary) {
        setNotice(finished.errorSummary);
      }
      reload();
      toast.created();
    } catch (e) {
      setListFailed(false);
      setError(e instanceof Error ? e.message : t('packageFailed'));
      toast.error(e, t('packageFailed'));
    } finally {
      setBusy(false);
    }
  };

  const download = async (job: ExportJob, format?: string) => {
    try {
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
      setDownloaded((prev) => ({ ...prev, [job.id]: true }));
    } catch (e) {
      setListFailed(false);
      setError(e instanceof Error ? e.message : t('downloadFailed'));
    }
  };

  const columns: TableColumn<ExportJob>[] = [
    {
      id: 'kind',
      header: t('kind'),
      cell: (j) => (
        <span className="font-en" dir="ltr">
          {j.kind}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('status'),
      cell: (j) => (
        <div className="space-y-token-2xs">
          <JobStatusBadge status={j.status} />
          {j.kind === 'ETA_PACKAGE' ? (
            <PackageProgress
              job={j}
              downloaded={Boolean(downloaded[j.id])}
              label={(key) => t(key)}
            />
          ) : null}
          {(j.errorSummary || j.etaPackage?.errorSummary) ? (
            <p className="m-0 text-token-xs text-danger" role="alert">
              {j.errorSummary || j.etaPackage?.errorSummary}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'download',
      header: t('download'),
      align: 'end',
      cell: (j) => (
        <span className="flex flex-wrap justify-end gap-token-sm">
          {j.status === 'READY' && j.kind === 'LOCAL'
            ? localDownloadFormats(j).map((f) => (
                <Button
                  key={f}
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => void download(j, f)}
                >
                  {t('download')}{' '}
                  <span className="font-en" dir="ltr">
                    {f.toUpperCase()}
                  </span>
                </Button>
              ))
            : null}
          {j.status === 'READY' && j.kind === 'ETA_PACKAGE' ? (
            <Button type="button" variant="link" size="sm" onClick={() => void download(j)}>
              {t('download')}{' '}
              <span className="font-en" dir="ltr">
                ZIP
              </span>
            </Button>
          ) : null}
        </span>
      ),
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
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setJobsLoading(true);
              void reload().finally(() => setJobsLoading(false));
            }}
          >
            {t('refresh')}
          </Button>
        }
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
                void reload().finally(() => setJobsLoading(false));
              }}
            >
              {t('retryLoad')}
            </Button>
          ) : null}
        </Card>
      ) : null}
      {notice ? (
        <Card role="status">
          <p className="m-0 text-token-sm">{notice}</p>
        </Card>
      ) : null}

      <section id="export-create" className="grid gap-token-lg md:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('exportData')}</CardTitle>
              <CardDescription>{t('local')}</CardDescription>
            </div>
          </CardHeader>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-token-sm text-token-sm font-medium text-foreground">
              {t('documentType')}
            </legend>
            <div className="flex flex-wrap gap-token-md">
              {(
                [
                  ['all', t('documentTypeAll')],
                  ['sales', t('documentTypeSales')],
                  ['purchases', t('documentTypePurchases')],
                ] as const
              ).map(([value, label]) => (
                <Radio
                  key={value}
                  name="export-document-type"
                  value={value}
                  checked={documentType === value}
                  onChange={() => setDocumentType(value)}
                  label={label}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="m-0 mt-token-md border-0 p-0">
            <legend className="mb-token-sm text-token-sm font-medium text-foreground">
              {t('formats')}
            </legend>
            <div className="flex flex-wrap gap-token-md">
              {(['CSV', 'XLSX', 'PDF', 'JSON'] as const).map((f) => (
                <Checkbox
                  key={f}
                  checked={formats.includes(f)}
                  onChange={() => toggleFormat(f)}
                  label={
                    <span className="font-en" dir="ltr">
                      {f}
                    </span>
                  }
                />
              ))}
            </div>
          </fieldset>
          <div className="mt-token-md grid gap-token-sm sm:grid-cols-2">
            <Input
              type="date"
              label={t('from')}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              type="date"
              label={t('to')}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button
            type="button"
            className="mt-token-md"
            disabled={busy || formats.length === 0}
            onClick={() => void startLocal()}
          >
            {t('createLocal')}
          </Button>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('etaPackage')}</CardTitle>
              <CardDescription>{t('etaPackageHelp')}</CardDescription>
            </div>
          </CardHeader>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !from || !to}
            onClick={() => void startPackage()}
          >
            {t('createPackage')}
          </Button>
        </Card>
      </section>

      <section>
        <h2 className="m-0 mb-token-md text-token-lg font-semibold text-foreground">
          {t('history')}
        </h2>
        {listFailed && !jobsLoading ? null : (
          <Table
            caption={t('listCaption')}
            columns={columns}
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
