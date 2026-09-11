import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useParams } from 'next/navigation';
import en from '@/messages/en.json';
import PurchaseDetailPage from './page';
import {
  acceptPurchase,
  getPurchase,
  rejectPurchase,
} from '@/lib/api/purchases';
import type { PurchaseDetail } from '@/lib/api/purchases';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/purchases/pur-1'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ id: 'pur-1', locale: 'en' })),
}));

jest.mock('@/lib/api/purchases', () => ({
  getPurchase: jest.fn(),
  acceptPurchase: jest.fn(),
  rejectPurchase: jest.fn(),
  declinePurchaseCancelation: jest.fn(),
  patchPurchase: jest.fn(),
  downloadPurchasePrintout: jest.fn(),
  downloadPurchaseLocalPrintout: jest.fn(),
}));

jest.mock('@/components/local-pdf-preview-modal', () => ({
  LocalPdfPreviewModal: () => null,
}));

function detail(overrides: Partial<PurchaseDetail> = {}): PurchaseDetail {
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
    netAmount: '100.00',
    lines: [
      {
        id: 'l1',
        lineNumber: 1,
        description: 'Widget',
        itemCode: 'EG-1',
        itemType: 'EGS',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '100.00',
        netTotal: '100.00',
        total: '114.00',
        taxes: [{ taxType: 'T1', subType: 'V009', rate: '14', amount: '14.00' }],
      },
    ],
    taxTotals: [{ taxType: 'T1', amount: '14.00' }],
    printoutAvailable: true,
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PurchaseDetailPage />
    </NextIntlClientProvider>,
  );
}

describe('purchase detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useParams as jest.Mock).mockReturnValue({ id: 'pur-1', locale: 'en' });
  });

  it('shows a loading skeleton while the purchase is fetched', () => {
    (getPurchase as jest.Mock).mockReturnValue(new Promise(() => undefined));
    renderDetail();
    expect(screen.getByTestId('purchase-detail-loading')).toBeInTheDocument();
  });

  it('renders an error with retry when loading fails', async () => {
    (getPurchase as jest.Mock).mockRejectedValue(new Error('missing'));
    renderDetail();
    expect(await screen.findByTestId('purchase-detail-error')).toHaveTextContent('missing');
    fireEvent.click(screen.getByRole('button', { name: en.purchases.retryLoad }));
    expect(getPurchase).toHaveBeenCalledTimes(2);
  });

  it('renders fields, lines, and existing actions', async () => {
    (getPurchase as jest.Mock).mockResolvedValue(detail());
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Seller Co' })).toBeInTheDocument();
    expect(screen.getAllByText('PINV-100').length).toBeGreaterThan(0);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.purchases.accept })).toBeEnabled();
    expect(screen.getByRole('button', { name: en.purchases.reject })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.purchases.declineCancelation })).toBeEnabled();
    expect(screen.getByRole('button', { name: en.purchases.localPreview })).toBeEnabled();
    expect(screen.getByRole('button', { name: en.purchases.downloadPdf })).toBeEnabled();
  });

  it('keeps reject disabled until a reason is entered, then posts that reason', async () => {
    (getPurchase as jest.Mock).mockResolvedValue(detail());
    (rejectPurchase as jest.Mock).mockResolvedValue(detail({ buyerDecision: 'REJECTED' }));
    renderDetail();
    await screen.findByRole('heading', { name: 'Seller Co' });
    const reject = screen.getByRole('button', { name: en.purchases.reject });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText(en.purchases.rejectReason), {
      target: { value: 'wrong amount' },
    });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);
    await waitFor(() => {
      expect(rejectPurchase).toHaveBeenCalledWith('pur-1', 'wrong amount');
    });
  });

  it('does not expose accept/reject when the buyer decision is terminal', async () => {
    (getPurchase as jest.Mock).mockResolvedValue(detail({ buyerDecision: 'ACCEPTED' }));
    renderDetail();
    await screen.findByRole('heading', { name: 'Seller Co' });
    expect(screen.getByRole('button', { name: en.purchases.accept })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.purchases.reject })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.purchases.declineCancelation })).toBeDisabled();
  });

  it('posts accept with the existing document id', async () => {
    (getPurchase as jest.Mock).mockResolvedValue(detail());
    (acceptPurchase as jest.Mock).mockResolvedValue(detail({ buyerDecision: 'ACCEPTED' }));
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: en.purchases.accept }));
    await waitFor(() => {
      expect(acceptPurchase).toHaveBeenCalledWith('pur-1');
    });
  });
});
