import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import {
  clearTenantQueue,
  countUnsynced,
  listDraftsForTenant,
  type DraftQueueItem,
} from '@/lib/offline/draft-queue';
import { SyncEngine } from '@/lib/offline/sync-engine';
import SyncPage from './page';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('@/lib/session', () => ({
  getActiveTenantId: () => 'tenant-1',
}));

jest.mock('@/lib/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/lib/offline/draft-queue', () => ({
  listDraftsForTenant: jest.fn(),
  countUnsynced: jest.fn(),
  clearTenantQueue: jest.fn(),
  summarizeStatuses: jest.requireActual('@/lib/offline/draft-queue').summarizeStatuses,
}));

jest.mock('@/lib/offline/sync-engine', () => ({
  SyncEngine: jest.fn().mockImplementation(() => ({
    drain: jest.fn().mockResolvedValue(undefined),
  })),
}));

function item(overrides: Partial<DraftQueueItem> = {}): DraftQueueItem {
  return {
    idempotencyKey: 'idem-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    baseRevision: 0,
    localRevision: 1,
    payload: {},
    status: 'pending',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SyncPage />
    </NextIntlClientProvider>,
  );
}

describe('sync page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listDraftsForTenant as jest.Mock).mockResolvedValue([]);
    (countUnsynced as jest.Mock).mockResolvedValue(0);
    (clearTenantQueue as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows a loading state instead of the empty queue', () => {
    (listDraftsForTenant as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.sync.empty)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows empty state when the queue has no drafts', async () => {
    renderPage();
    expect(await screen.findByText(en.sync.empty)).toBeInTheDocument();
    expect(screen.getByText(en.sync.online)).toBeInTheDocument();
  });

  it('renders real queue counts and status labels', async () => {
    (listDraftsForTenant as jest.Mock).mockResolvedValue([
      item(),
      item({ idempotencyKey: 'idem-2', status: 'failed', lastError: 'boom' }),
      item({ idempotencyKey: 'idem-3', status: 'conflict' }),
    ]);
    renderPage();
    expect(await screen.findByText(en.sync.status.pending)).toBeInTheDocument();
    expect(screen.getByText(en.sync.status.failed)).toBeInTheDocument();
    expect(screen.getByText(en.sync.status.conflict)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('idem-1')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('link', { name: en.conflict.title })).toHaveAttribute(
      'href',
      '/en/sync/conflict?key=idem-3',
    );
  });

  it('retries with a SyncEngine bound to the active tenant and user', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.sync.retry }));
    await waitFor(() => {
      expect(SyncEngine).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' });
    });
    const instance = (SyncEngine as unknown as jest.Mock).mock.results[0].value as {
      drain: jest.Mock;
    };
    expect(instance.drain).toHaveBeenCalled();
  });

  it('discards immediately when there are no unsynced drafts', async () => {
    (countUnsynced as jest.Mock).mockResolvedValue(0);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.sync.discardConfirm }));
    await waitFor(() => {
      expect(clearTenantQueue).toHaveBeenCalledWith('tenant-1');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for confirmation before discarding unsynced drafts', async () => {
    (countUnsynced as jest.Mock).mockResolvedValue(2);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.sync.discardConfirm }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(en.sync.discardWarn);
    fireEvent.click(within(dialog).getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(clearTenantQueue).not.toHaveBeenCalled();
  });

  it('clears the tenant queue after discard is confirmed', async () => {
    (countUnsynced as jest.Mock).mockResolvedValue(1);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.sync.discardConfirm }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.sync.discardConfirm }));
    await waitFor(() => {
      expect(clearTenantQueue).toHaveBeenCalledWith('tenant-1');
    });
  });
});
