import { apiFetch } from './client';

export type BackupJob = {
  id: string;
  tenantId: string;
  status: string;
  triggerSource: string;
  byteSize: number | null;
  checksumSha256: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export function listBackupJobs() {
  return apiFetch<{ items: BackupJob[] }>('/backup/jobs', { tenantScoped: true });
}

export function createBackupJob() {
  return apiFetch<BackupJob>('/backup/jobs', {
    method: 'POST',
    body: {},
    tenantScoped: true,
  });
}

export function restoreBackup(backupJobId: string) {
  return apiFetch<unknown>('/backup/restores', {
    method: 'POST',
    body: { backupJobId, confirmation: 'RESTORE' },
    tenantScoped: true,
  });
}

export function wipeOperational() {
  return apiFetch<{ ok: boolean }>('/backup/wipe-operational', {
    method: 'POST',
    body: {},
    tenantScoped: true,
  });
}
