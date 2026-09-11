import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { getDraft, putDraft, type DraftQueueItem } from '@/lib/offline/draft-queue';
import { resolveSyncConflict } from '@/lib/api/sync';
import ConflictPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'key' ? 'idem-1' : null) }),
  useRouter: () => ({ push }),
  useParams: () => ({ locale: 'en' }),
  usePathname: () => '/en/sync/conflict',
}));

jest.mock('@/lib/offline/draft-queue', () => ({
  getDraft: jest.fn(),
  putDraft: jest.fn(),
}));

jest.mock('@/lib/api/sync', () => ({
  resolveSyncConflict: jest.fn(),
}));

function conflictItem(overrides: Partial<DraftQueueItem> = {}): DraftQueueItem {
  return {
    idempotencyKey: 'idem-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    baseRevision: 1,
    localRevision: 2,
    payload: { __conflictId: 'conflict-9', issuer: 'local' },
    status: 'conflict',
    lastError: 'conflict-9',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConflictPage />
    </NextIntlClientProvider>,
  );
}

describe('sync conflict page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDraft as jest.Mock).mockResolvedValue(conflictItem());
    (putDraft as jest.Mock).mockResolvedValue(undefined);
    (resolveSyncConflict as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      syncRevision: 3,
      clientIdempotencyKey: 'idem-1',
      status: 'synced',
    });
  });

  it('renders the queued item key', async () => {
    renderPage();
    expect(await screen.findByText('idem-1')).toBeInTheDocument();
    expect(screen.getByText('idem-1')).toHaveAttribute('dir', 'ltr');
  });

  it('resolves KEEP_LOCAL with the existing payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.keepLocal }));
    await waitFor(() => {
      expect(resolveSyncConflict).toHaveBeenCalledWith('conflict-9', {
        resolution: 'KEEP_LOCAL',
        mergedPayload: conflictItem().payload,
      });
    });
    expect(push).toHaveBeenCalledWith('/en/sync');
  });

  it('resolves KEEP_SERVER without a merged payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.keepServer }));
    await waitFor(() => {
      expect(resolveSyncConflict).toHaveBeenCalledWith('conflict-9', {
        resolution: 'KEEP_SERVER',
        mergedPayload: undefined,
      });
    });
  });

  it('resolves MERGED with the local payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.merge }));
    await waitFor(() => {
      expect(resolveSyncConflict).toHaveBeenCalledWith('conflict-9', {
        resolution: 'MERGED',
        mergedPayload: conflictItem().payload,
      });
    });
  });

  it('shows the missing-id error without calling resolve', async () => {
    (getDraft as jest.Mock).mockResolvedValue(
      conflictItem({ payload: {}, lastError: 'conflict' }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.conflict.keepLocal }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.conflict.missingId);
    expect(resolveSyncConflict).not.toHaveBeenCalled();
  });
});
