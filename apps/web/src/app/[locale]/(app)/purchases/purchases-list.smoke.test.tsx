import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@/components/ui/toast';
import {
  latestPurchaseSync,
  listPurchases,
  syncPurchases,
} from '@/lib/api/purchases';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import PurchasesPage from './page';
import type { PurchaseSummary } from '@/lib/api/purchases';
import { PAGE_SIZE } from './_components/purchase-list-utils';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/purchases'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ locale: 'en' })),
}));

jest.mock('@/lib/api/purchases', () => ({
  listPurchases: jest.fn(),
  latestPurchaseSync: jest.fn(),
  syncPurchases: jest.fn(),
  resetPurchaseSync: jest.fn(),
}));

function purchaseItem(overrides: Partial<PurchaseSummary> = {}): PurchaseSummary {
  return {
    id: 'pur-1',
    documentUuid: 'uuid-1',
    etaLongId: 'long-1',
    internalId: 'PINV-100',
    kind: 'PURCHASE_INVOICE',
    etaDocumentType: 'I',
    etaStatus: 'Valid',
    dateTimeIssued: '2026-09-01T10:00:00.000Z',
    issuerName: 'Seller Co',
    issuerId: '123456789',
    issuerType: 'B',
    totalAmount: '114.00',
    currency: 'EGP',
    buyerDecision: 'PENDING',
    reconciliationStatus: 'PENDING_REVIEW',
    branchId: 'branch-1',
    needsAttention: false,
    lastSyncedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderList(locale: 'en' | 'ar' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <ToastProvider>
        <PurchasesPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe('purchases list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (latestPurchaseSync as jest.Mock).mockResolvedValue({ status: 'SUCCEEDED' });
  });

  it('keeps the existing cursor page size', () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it('shows a loading skeleton until the first fetch settles', async () => {
    let resolveList!: (value: { items: PurchaseSummary[]; nextCursor: string | null }) => void;
    (listPurchases as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    renderList();
    expect(screen.getByTestId('purchases-loading')).toBeInTheDocument();
    await act(async () => {
      resolveList({ items: [], nextCursor: null });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('purchases-loading')).not.toBeInTheDocument();
    });
  });

  it('renders an empty state when there are no purchases', async () => {
    (listPurchases as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    renderList();
    expect(await screen.findByTestId('purchases-empty')).toBeInTheDocument();
    expect(screen.getByText(en.purchases.empty)).toBeInTheDocument();
  });

  it('renders an error with retry when the list fails', async () => {
    (listPurchases as jest.Mock).mockRejectedValue(new Error('boom'));
    renderList();
    const alert = await screen.findByTestId('purchases-error');
    expect(alert).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: en.purchases.retryLoad })).toBeInTheDocument();
  });

  it('renders filters, table rows, and the invoice link', async () => {
    (listPurchases as jest.Mock).mockResolvedValue({
      items: [purchaseItem()],
      nextCursor: null,
    });
    renderList();
    expect(await screen.findByTestId('purchases-table')).toBeInTheDocument();
    expect(screen.getByTestId('purchases-page')).toBeInTheDocument();
    expect(screen.getByText('PINV-100')).toBeInTheDocument();
    expect(screen.getByText('Seller Co')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: en.purchases.filterSearch })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PINV-100' })).toHaveAttribute(
      'href',
      '/en/purchases/pur-1',
    );
  });

  it('sends the existing search query to the API', async () => {
    (listPurchases as jest.Mock).mockResolvedValue({
      items: [purchaseItem()],
      nextCursor: null,
    });
    renderList();
    await screen.findByTestId('purchases-table');
    fireEvent.change(screen.getByRole('textbox', { name: en.purchases.filterSearch }), {
      target: { value: 'PINV-100' },
    });
    await waitFor(() => {
      expect(listPurchases).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'PINV-100', limit: 50 }),
      );
    });
  });

  it('sorts invoice id ascending on first click, matching the previous column behavior', async () => {
    (listPurchases as jest.Mock).mockResolvedValue({
      items: [purchaseItem()],
      nextCursor: null,
    });
    renderList();
    await screen.findByTestId('purchases-table');
    fireEvent.click(screen.getByRole('button', { name: en.purchases.colInvoice }));
    await waitFor(() => {
      expect(listPurchases).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'internalId', sortDir: 'asc', limit: 50 }),
      );
    });
  });

  it('sends the existing status filter value to the API', async () => {
    (listPurchases as jest.Mock).mockResolvedValue({
      items: [purchaseItem()],
      nextCursor: null,
    });
    renderList();
    await screen.findByTestId('purchases-table');
    fireEvent.click(screen.getByRole('button', { name: en.purchases.etaStatusValid }));
    await waitFor(() => {
      expect(listPurchases).toHaveBeenCalledWith(
        expect.objectContaining({ etaStatus: 'Valid', limit: 50 }),
      );
    });
  });

  it('loads more with the existing cursor', async () => {
    (listPurchases as jest.Mock)
      .mockResolvedValueOnce({ items: [purchaseItem()], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({
        items: [purchaseItem({ id: 'pur-2', internalId: 'PINV-200' })],
        nextCursor: null,
      });
    renderList();
    await screen.findByText('PINV-100');
    fireEvent.click(screen.getByRole('button', { name: en.purchases.loadMore }));
    expect(await screen.findByText('PINV-200')).toBeInTheDocument();
    expect(listPurchases).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2', limit: 50 }),
    );
  });

  it('renders Arabic chrome without flipping the LTR invoice id', async () => {
    (listPurchases as jest.Mock).mockResolvedValue({
      items: [purchaseItem()],
      nextCursor: null,
    });
    renderList('ar');
    expect(await screen.findByRole('heading', { name: ar.purchases.title })).toBeInTheDocument();
    expect(await screen.findByText('PINV-100')).toHaveAttribute('dir', 'ltr');
  });
});

describe('purchases list sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (latestPurchaseSync as jest.Mock).mockResolvedValue({ status: 'SUCCEEDED' });
    (listPurchases as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    (syncPurchases as jest.Mock).mockResolvedValue({ status: 'PENDING' });
  });

  it('posts the existing sync range payload', async () => {
    (latestPurchaseSync as jest.Mock)
      .mockResolvedValueOnce({ status: 'SUCCEEDED' })
      .mockResolvedValue({ status: 'SUCCEEDED', newCount: 1, updatedCount: 0, skippedCount: 0 });
    renderList();
    await screen.findByTestId('purchases-empty');
    fireEvent.click(screen.getAllByRole('button', { name: en.purchases.syncNow })[0]!);
    await waitFor(() => {
      expect(syncPurchases).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.stringMatching(/T00:00:00.000Z$/),
          to: expect.stringMatching(/T23:59:59.999Z$/),
        }),
      );
    });
  });
});
