import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { useParams } from 'next/navigation';
import en from '@/messages/en.json';
import DocumentEditorPage from './page';
import { getDocument, submitDocumentToEta } from '@/lib/api/documents';
import { cancelDocument } from '@/lib/api/submissions';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/documents/new'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ id: 'new', locale: 'en' })),
}));

jest.mock('@/lib/auth-provider', () => ({
  useAuth: () => ({
    ready: true,
    user: { id: 'u1', email: 'owner@test.local', name: 'Owner' },
  }),
}));

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    memberships: [],
    branches: [{ id: 'branch-1', name: 'Main' }],
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
    roleName: 'Owner',
  }),
}));

jest.mock('@/lib/api/client', () => ({
  ApiError: class ApiError extends Error {
    status = 0;
  },
  apiFetch: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/api/eta-codes', () => ({
  listEtaCodes: jest.fn().mockResolvedValue({ entries: [] }),
}));

jest.mock('@/lib/api/item-codes', () => ({
  listItemCodes: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/api/invoice-numbering', () => ({
  allocateNextInternalId: jest.fn().mockResolvedValue({ internalId: 'INV-NEW' }),
}));

jest.mock('@/lib/api/documents', () => ({
  createDocument: jest.fn(),
  createReturnCreditNote: jest.fn(),
  downloadLocalPrintoutFromBody: jest.fn(),
  getDocument: jest.fn(),
  listDocuments: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  markDocumentReady: jest.fn(),
  previewDocument: jest.fn(),
  recalculateDocumentTotals: jest.fn(),
  sendDocumentForSignature: jest.fn(),
  submitDocumentToEta: jest.fn(),
  resetDocumentSubmitCooldown: jest.fn(),
  updateDocument: jest.fn(),
  validateDocument: jest.fn(),
}));

jest.mock('@/lib/api/submissions', () => ({
  cancelDocument: jest.fn(),
  declineDocumentRejection: jest.fn(),
  downloadDocumentEtaSource: jest.fn(),
  downloadDocumentPrintout: jest.fn(),
  refreshDocumentStatus: jest.fn(),
  triggerBrowserDownload: jest.fn(),
}));

jest.mock('@/components/customers/customer-picker', () => ({
  CustomerPicker: () => <div data-testid="customer-picker" />,
}));

jest.mock('@/components/local-pdf-preview-modal', () => ({
  LocalPdfPreviewModal: () => null,
}));

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <DocumentEditorPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('document detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useParams as jest.Mock).mockReturnValue({ id: 'new', locale: 'en' });
  });

  it('renders the new-document editor with XIRA header and actions', async () => {
    renderDetail();
    expect(screen.getByTestId('document-detail')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: en.documents.new })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.documents.save })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.documents.previewPrint })).toBeInTheDocument();
  });

  it('loads an existing document without rewriting status semantics', async () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'doc-1', locale: 'en' });
    (getDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      kind: 'INVOICE',
      branchId: 'branch-1',
      currencyCode: 'EGP',
      internalId: 'INV-EXISTING',
      issueDateTime: new Date().toISOString(),
      version: 1,
      status: 'SIGNED',
      origin: 'LOCAL',
      etaPayload: {
        taxpayerActivityCode: '1000',
        issuer: { type: 'B', id: '1', name: 'Issuer' },
        receiver: { type: 'B', id: '2', name: 'Buyer' },
        invoiceLines: [],
      },
      totals: { totalAmount: '0.00' },
      lines: [],
      canonicalString: '',
    });
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'INV-EXISTING' })).toBeInTheDocument();
    expect(screen.getAllByText(en.documents.statusSigned).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: en.documents.submitToEta })).toBeInTheDocument();
  });

  it('does not submit when late confirmation is cancelled', async () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'doc-1', locale: 'en' });
    (getDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      kind: 'INVOICE',
      branchId: 'branch-1',
      currencyCode: 'EGP',
      internalId: 'INV-LATE',
      issueDateTime: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      version: 1,
      status: 'SIGNED',
      origin: 'LOCAL',
      etaPayload: { invoiceLines: [] },
      totals: {},
      lines: [],
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: en.documents.submitToEta }));
    expect(await screen.findByText(/issued more than/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => {
      expect(submitDocumentToEta).not.toHaveBeenCalled();
    });
  });

  it('opens the cancel-reason dialog instead of window.prompt', async () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'doc-1', locale: 'en' });
    (getDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      kind: 'INVOICE',
      branchId: 'branch-1',
      currencyCode: 'EGP',
      internalId: 'INV-VALID',
      issueDateTime: new Date().toISOString(),
      version: 1,
      status: 'VALID',
      origin: 'LOCAL',
      etaUuid: 'eta-1',
      etaPayload: { invoiceLines: [] },
      totals: {},
      lines: [],
    });
    (cancelDocument as jest.Mock).mockResolvedValue({});
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: en.documents.cancelDocument }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(cancelDocument).not.toHaveBeenCalled();
  });
});
