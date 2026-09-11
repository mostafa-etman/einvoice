'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createBackupJob,
  listBackupJobs,
  restoreBackup,
  wipeOperational,
  type BackupJob,
} from '@/lib/api/backup';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function backupStatusVariant(status: string): BadgeVariant {
  const upper = status.toUpperCase();
  if (upper === 'COMPLETED') return 'success';
  if (upper === 'FAILED') return 'danger';
  if (upper === 'RUNNING' || upper === 'PENDING') return 'warning';
  return 'neutral';
}

function formatByteSize(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export default function BackupPage() {
  const t = useTranslations('backup');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const qc = useQueryClient();
  const [wipeOpen, setWipeOpen] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: ['backup-jobs'],
    queryFn: () => listBackupJobs(),
    refetchInterval: 3000,
  });

  const createMut = useMutation({
    mutationFn: () => createBackupJob(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-jobs'] }),
  });

  const wipeMut = useMutation({
    mutationFn: () => wipeOperational(),
  });

  const restoreMut = useMutation({
    mutationFn: (backupJobId: string) => restoreBackup(backupJobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-jobs'] }),
  });

  const columns: TableColumn<BackupJob>[] = [
    {
      id: 'status',
      header: t('colStatus'),
      cell: (job) => (
        <div className="space-y-token-2xs">
          <Badge variant={backupStatusVariant(job.status)}>
            <span dir="ltr">{job.status}</span>
          </Badge>
          {job.errorMessage ? (
            <p className="m-0 text-token-xs text-danger" role="alert">
              {job.errorMessage}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'source',
      header: t('colSource'),
      cell: (job) => (
        <span className="font-en" dir="ltr">
          {job.triggerSource}
        </span>
      ),
    },
    {
      id: 'size',
      header: t('colSize'),
      cell: (job) => (
        <span className="font-en tabular-nums" dir="ltr">
          {formatByteSize(job.byteSize)}
        </span>
      ),
    },
    {
      id: 'checksum',
      header: t('colChecksum'),
      cell: (job) => (
        <span className="font-en text-token-xs" dir="ltr">
          {job.checksumSha256?.slice(0, 12) ?? '—'}
        </span>
      ),
    },
    {
      id: 'created',
      header: t('colCreated'),
      cell: (job) => (
        <span className="font-en text-token-xs" dir="ltr">
          {new Date(job.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('colActions'),
      align: 'end',
      cell: (job) =>
        job.status === 'COMPLETED' ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setRestoreId(job.id)}
          >
            {t('restore')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-token-lg">
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
        subtitle={t('subtitle')}
        actions={
          <>
            <Button
              type="button"
              variant="danger"
              disabled={wipeMut.isPending}
              onClick={() => setWipeOpen(true)}
            >
              {t('wipe')}
            </Button>
            <Button
              type="button"
              disabled={createMut.isPending}
              loading={createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {t('create')}
            </Button>
          </>
        }
      />

      {createMut.isError ? (
        <p className="text-token-sm text-danger" role="alert">
          {String(createMut.error)}
        </p>
      ) : null}
      {wipeMut.isError ? (
        <p className="text-token-sm text-danger" role="alert">
          {wipeMut.error instanceof Error ? wipeMut.error.message : t('errorGeneric')}
        </p>
      ) : null}
      {restoreMut.isError ? (
        <p className="text-token-sm text-danger" role="alert">
          {restoreMut.error instanceof Error ? restoreMut.error.message : t('errorGeneric')}
        </p>
      ) : null}
      {jobs.isError ? (
        <Card className="border-danger" role="alert">
          <p className="text-token-sm text-danger">
            {jobs.error instanceof Error ? jobs.error.message : t('errorGeneric')}
          </p>
          <Button
            className="mt-token-sm"
            variant="secondary"
            size="sm"
            onClick={() => void jobs.refetch()}
          >
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      <Table
        caption={t('listCaption')}
        columns={columns}
        rows={jobs.data?.items ?? []}
        getRowId={(job) => job.id}
        loading={jobs.isLoading}
        empty={<EmptyState title={t('empty')} action={{ label: t('create'), onClick: () => createMut.mutate() }} />}
      />

      <ConfirmDialog
        open={wipeOpen}
        onClose={() => setWipeOpen(false)}
        onConfirm={() => {
          setWipeOpen(false);
          wipeMut.mutate();
        }}
        title={t('wipeTitle')}
        description={t('wipeConfirm')}
        confirmLabel={t('wipe')}
        danger
        loading={wipeMut.isPending}
      />

      <ConfirmDialog
        open={restoreId !== null}
        onClose={() => setRestoreId(null)}
        onConfirm={() => {
          if (!restoreId) return;
          restoreMut.mutate(restoreId);
          setRestoreId(null);
        }}
        title={t('restoreTitle')}
        description={t('restoreConfirm')}
        confirmLabel={t('restore')}
        danger
        loading={restoreMut.isPending}
      />
    </div>
  );
}
