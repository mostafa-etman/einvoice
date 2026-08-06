'use client';

import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createBackupJob,
  listBackupJobs,
  restoreBackup,
  wipeOperational,
} from '@/lib/api/backup';

export default function BackupPage() {
  const t = useTranslations('backup');
  const qc = useQueryClient();

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

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm"
          disabled={createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          {t('create')}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={wipeMut.isPending}
          onClick={() => {
            if (confirm(t('wipeConfirm'))) wipeMut.mutate();
          }}
        >
          {t('wipe')}
        </button>
      </div>

      {createMut.isError && (
        <p className="text-destructive text-sm">{String(createMut.error)}</p>
      )}

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b text-left">
              <th className="p-2">{t('colStatus')}</th>
              <th className="p-2">{t('colSource')}</th>
              <th className="p-2">{t('colChecksum')}</th>
              <th className="p-2">{t('colCreated')}</th>
              <th className="p-2">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data?.items ?? []).map((job) => (
              <tr key={job.id} className="border-b">
                <td className="p-2">{job.status}</td>
                <td className="p-2">{job.triggerSource}</td>
                <td className="p-2 font-mono text-xs">
                  {job.checksumSha256?.slice(0, 12) ?? '—'}
                </td>
                <td className="p-2">{new Date(job.createdAt).toLocaleString()}</td>
                <td className="p-2">
                  {job.status === 'COMPLETED' && (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => {
                        if (confirm(t('restoreConfirm'))) {
                          restoreMut.mutate(job.id);
                        }
                      }}
                    >
                      {t('restore')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!jobs.data?.items?.length && (
              <tr>
                <td className="text-muted-foreground p-4" colSpan={5}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
