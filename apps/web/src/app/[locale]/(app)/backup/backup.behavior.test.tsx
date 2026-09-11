import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ApiError } from '@/lib/api/client';
import {
  createBackupJob,
  listBackupJobs,
  restoreBackup,
  wipeOperational,
  type BackupJob,
} from '@/lib/api/backup';
import BackupPage from './page';

jest.mock('@/lib/api/backup', () => ({
  listBackupJobs: jest.fn(),
  createBackupJob: jest.fn(),
  restoreBackup: jest.fn(),
  wipeOperational: jest.fn(),
}));

function job(overrides: Partial<BackupJob> = {}): BackupJob {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    status: 'COMPLETED',
    triggerSource: 'MANUAL',
    byteSize: 2048,
    checksumSha256: 'abcdef1234567890',
    errorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}

function renderPage(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={en}>
          <BackupPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('backup page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listBackupJobs as jest.Mock).mockResolvedValue({ items: [job()] });
    (createBackupJob as jest.Mock).mockResolvedValue(job());
    (restoreBackup as jest.Mock).mockResolvedValue({});
    (wipeOperational as jest.Mock).mockResolvedValue({ ok: true });
  });

  it('keeps the backup-jobs query key and polling interval', async () => {
    const { qc } = renderPage();
    expect(await screen.findByText('MANUAL')).toBeInTheDocument();
    await waitFor(() => {
      const cached = qc.getQueryCache().findAll();
      expect(cached.map((q) => q.queryKey)).toEqual(expect.arrayContaining([['backup-jobs']]));
      const opts = cached.find((q) => q.queryKey[0] === 'backup-jobs')?.options as {
        refetchInterval?: number;
      };
      expect(opts.refetchInterval).toBe(3000);
    });
  });

  it('shows a loading table instead of empty', () => {
    (listBackupJobs as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.backup.empty)).not.toBeInTheDocument();
  });

  it('shows empty state when there are no jobs', async () => {
    (listBackupJobs as jest.Mock).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByText(en.backup.empty)).toBeInTheDocument();
  });

  it('renders real job fields including size from byteSize', async () => {
    renderPage();
    expect(await screen.findByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('MANUAL')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('abcdef123456')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('retries a failed jobs load', async () => {
    (listBackupJobs as jest.Mock)
      .mockRejectedValueOnce(new ApiError('down', 500))
      .mockResolvedValueOnce({ items: [job()] });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.backup.retryLoad }));
    expect(await screen.findByText('COMPLETED')).toBeInTheDocument();
  });

  it('creates a backup with the existing empty payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.backup.create }));
    await waitFor(() => {
      expect(createBackupJob).toHaveBeenCalledWith();
    });
  });

  it('does not restore until confirmation, then sends the job id', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.backup.restore }));
    const dialog = await screen.findByRole('dialog');
    expect(restoreBackup).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: en.backup.restore }));
    await waitFor(() => {
      expect(restoreBackup).toHaveBeenCalledWith('job-1');
    });
  });

  it('hides restore for jobs that are not COMPLETED', async () => {
    (listBackupJobs as jest.Mock).mockResolvedValue({
      items: [job({ status: 'PENDING' })],
    });
    renderPage();
    expect(await screen.findByText('PENDING')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.backup.restore })).not.toBeInTheDocument();
  });

  it('cancels wipe without mutating', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.backup.wipe }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(wipeOperational).not.toHaveBeenCalled();
  });

  it('wipes operational data after confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.backup.wipe }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.backup.wipe }));
    await waitFor(() => {
      expect(wipeOperational).toHaveBeenCalledWith();
    });
  });
});
