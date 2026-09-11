import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@/components/ui/toast';
import { listDocuments, latestSalesSync } from '@/lib/api/documents';
import {
  createSubmission,
  refreshDocumentsStatus,
} from '@/lib/api/submissions';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import DocumentsPage from './page';
import {
  AUTO_POLL_MS,
} from './_components/document-list-utils';
import type { DocumentListItem } from '@/lib/api/documents';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/documents'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ locale: 'en' })),
}));

jest.mock('@/lib/api/documents', () => ({
  listDocuments: jest.fn(),
  latestSalesSync: jest.fn(),
  syncSales: jest.fn(),
  resetSalesSync: jest.fn(),
  deleteDocument: jest.fn(),
  createReturnCreditNote: jest.fn(),
  downloadLocalPrintout: jest.fn(),
}));

jest.mock('@/lib/api/submissions', () => ({
  createSubmission: jest.fn(),
  cancelDocument: jest.fn(),
  cancelDocumentsSelected: jest.fn(),
  downloadDocumentPrintout: jest.fn(),
  refreshDocumentStatus: jest.fn(),
  refreshDocumentsStatus: jest.fn(),
  triggerBrowserDownload: jest.fn(),
}));

jest.mock('@/components/local-pdf-preview-modal', () => ({
  LocalPdfPreviewModal: () => null,
}));

function docItem(overrides: Partial<DocumentListItem> = {}): DocumentListItem {
  return {
    id: 'doc-1',
    kind: 'INVOICE',
    status: 'DRAFT',
    origin: 'LOCAL',
    internalId: 'INV-100',
    issueDateTime: '2026-09-01T10:00:00.000Z',
    currencyCode: 'EGP',
    totalAmount: '114.00',
    receiverName: 'Acme Co',
    receiverId: '123456789',
    updatedAt: '2026-09-01T10:00:00.000Z',
    needsAttention: false,
    needsAttentionReason: null,
    submissionUuid: null,
    etaUuid: null,
    etaLongId: null,
    etaStatus: null,
    etaStatusUpdatedAt: null,
    submitInFlight: false,
    submitCooldownUntil: null,
    ...overrides,
  };
}

function renderList(locale: 'en' | 'ar' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <ToastProvider>
        <DocumentsPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe('documents list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (latestSalesSync as jest.Mock).mockResolvedValue({ status: 'SUCCEEDED' });
    (refreshDocumentsStatus as jest.Mock).mockResolvedValue({
      requested: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
  });

  it('registers the existing auto-poll interval while the list is open', async () => {
    const spy = jest.spyOn(window, 'setInterval');
    try {
      (listDocuments as jest.Mock).mockResolvedValue({
        items: [docItem({ status: 'SUBMITTED' })],
        nextCursor: null,
      });
      renderList();
      await screen.findByTestId('documents-table');
      expect(spy).toHaveBeenCalledWith(expect.any(Function), AUTO_POLL_MS);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows a loading skeleton until the first fetch settles', async () => {
    let resolveList!: (value: { items: DocumentListItem[]; nextCursor: string | null }) => void;
    (listDocuments as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    renderList();
    expect(screen.getByTestId('documents-loading')).toBeInTheDocument();
    await act(async () => {
      resolveList({ items: [], nextCursor: null });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('documents-loading')).not.toBeInTheDocument();
    });
  });

  it('renders an empty state when there are no documents', async () => {
    (listDocuments as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    renderList();
    expect(await screen.findByTestId('documents-empty')).toBeInTheDocument();
    expect(screen.getByText(en.documents.empty)).toBeInTheDocument();
  });

  it('renders an error with retry when the list fails', async () => {
    (listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));
    renderList();
    const alert = await screen.findByTestId('documents-error');
    expect(alert).toHaveTextContent('boom');
    expect(within(alert).getByRole('button', { name: en.documents.retryLoad })).toBeInTheDocument();
  });

  it('renders filters, table rows, and row actions', async () => {
    (listDocuments as jest.Mock).mockResolvedValue({
      items: [docItem({ etaUuid: 'eta-uuid-1', status: 'VALID' })],
      nextCursor: null,
    });
    renderList();
    expect(await screen.findByTestId('documents-table')).toBeInTheDocument();
    expect(screen.getByTestId('documents-page')).toBeInTheDocument();
    expect(screen.getByTestId('documents-new')).toBeInTheDocument();
    expect(screen.getByText('INV-100')).toBeInTheDocument();
    expect(screen.getByText('Acme Co')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: en.documents.filterSearch })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.documents.actionsMenu }));
    expect(screen.getByRole('menuitem', { name: en.documents.view })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: en.documents.previewPrint })).toBeInTheDocument();
  });

  it('keeps server filtering by sending status on chip click', async () => {
    (listDocuments as jest.Mock).mockResolvedValue({ items: [docItem()], nextCursor: null });
    renderList();
    await screen.findByTestId('documents-table');
    fireEvent.click(screen.getByRole('button', { name: en.documents.statusDraft }));
    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DRAFT', limit: 50 }),
      );
    });
  });

  it('loads more with the existing cursor instead of client pagination', async () => {
    (listDocuments as jest.Mock)
      .mockResolvedValueOnce({ items: [docItem()], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({
        items: [docItem({ id: 'doc-2', internalId: 'INV-200' })],
        nextCursor: null,
      });
    renderList();
    await screen.findByText('INV-100');
    fireEvent.click(screen.getByRole('button', { name: en.documents.loadMore }));
    expect(await screen.findByText('INV-200')).toBeInTheDocument();
    expect(listDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2', limit: 50 }),
    );
  });

  it('shows the bulk bar after row selection', async () => {
    (listDocuments as jest.Mock).mockResolvedValue({ items: [docItem()], nextCursor: null });
    renderList();
    await screen.findByTestId('documents-table');
    expect(screen.queryByTestId('documents-bulk-bar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: en.documents.selectRow.replace('{internalId}', 'INV-100') }));
    expect(screen.getByTestId('documents-bulk-bar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.documents.sendSelected })).toBeInTheDocument();
  });

  it('renders Arabic list chrome without flipping the LTR invoice id', async () => {
    (listDocuments as jest.Mock).mockResolvedValue({ items: [docItem()], nextCursor: null });
    renderList('ar');
    expect(await screen.findByRole('heading', { name: ar.documents.title })).toBeInTheDocument();
    const idLink = await screen.findByText('INV-100');
    expect(idLink).toHaveAttribute('dir', 'ltr');
  });
});

describe('documents list late submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (latestSalesSync as jest.Mock).mockResolvedValue({ status: 'SUCCEEDED' });
    (createSubmission as jest.Mock).mockResolvedValue({
      requested: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
      submissionId: 'sub-1',
      submission: {},
      lateWarnings: [],
      results: [],
    });
    (listDocuments as jest.Mock).mockResolvedValue({
      items: [
        docItem({
          status: 'SIGNED',
          issueDateTime: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      nextCursor: null,
    });
  });

  it('asks for confirmation before a late send and does nothing on cancel', async () => {
    renderList();
    await screen.findByTestId('documents-table');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: en.documents.selectRow.replace('{internalId}', 'INV-100'),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: en.documents.sendSelected }));
    expect(await screen.findByText(/issued more than/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => {
      expect(createSubmission).not.toHaveBeenCalled();
    });
  });

  it('sends after confirming a late submission', async () => {
    renderList();
    await screen.findByTestId('documents-table');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: en.documents.selectRow.replace('{internalId}', 'INV-100'),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: en.documents.sendSelected }));
    expect(await screen.findByText(/issued more than/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.common.actions.confirm }));
    await waitFor(() => {
      expect(createSubmission).toHaveBeenCalledWith(['doc-1']);
    });
  });
});

describe('documents list batch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (latestSalesSync as jest.Mock).mockResolvedValue({ status: 'SUCCEEDED' });
    (listDocuments as jest.Mock).mockResolvedValue({
      items: [
        docItem({ id: 'doc-1', internalId: 'INV-100', status: 'SIGNED', issueDateTime: new Date().toISOString() }),
        docItem({ id: 'doc-2', internalId: 'INV-200', status: 'SIGNED', issueDateTime: new Date().toISOString() }),
      ],
      nextCursor: null,
    });
    (createSubmission as jest.Mock).mockResolvedValue({
      requested: 2,
      sent: 1,
      skipped: 0,
      failed: 1,
      submissionId: 'sub-1',
      submission: {},
      lateWarnings: [],
      results: [
        { documentId: 'doc-1', internalId: 'INV-100', outcome: 'sent', documentStatus: 'SUBMITTED' },
        {
          documentId: 'doc-2',
          internalId: 'INV-200',
          outcome: 'failed',
          reason: 'eta-down',
          documentStatus: 'SIGNED',
        },
      ],
    });
  });

  it('summarizes partial batch success and reloads the list', async () => {
    renderList();
    await screen.findByTestId('documents-table');
    fireEvent.click(screen.getByRole('checkbox', { name: en.documents.selectAllMatching }));
    fireEvent.click(screen.getByRole('button', { name: en.documents.sendSelected }));
    await waitFor(() => {
      expect(createSubmission).toHaveBeenCalledWith(['doc-1', 'doc-2']);
    });
    expect(
      await screen.findByText(
        en.documents.batchSendSummary
          .replace('{sent}', '1')
          .replace('{skipped}', '0')
          .replace('{failed}', '1'),
      ),
    ).toBeInTheDocument();
    expect(listDocuments.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
