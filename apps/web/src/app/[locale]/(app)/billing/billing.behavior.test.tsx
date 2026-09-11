import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import { ApiError } from '@/lib/api/client';
import {
  fetchCatalog,
  fetchInvoices,
  fetchQuotas,
  fetchSubscription,
} from '@/lib/api/billing';
import BillingPage from './page';

jest.mock('@/lib/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'owner@test.local' } }),
}));

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    branchId: null,
    memberships: [],
    branches: [],
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
    roleName: 'Owner',
  }),
}));

jest.mock('@/lib/api/billing', () => ({
  fetchCatalog: jest.fn(),
  fetchInvoices: jest.fn(),
  fetchQuotas: jest.fn(),
  fetchSubscription: jest.fn(),
}));

function renderPage(locale: 'en' | 'ar' = 'en') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
          <BillingPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('billing page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchCatalog as jest.Mock).mockResolvedValue({
      currency: 'EGP',
      billingPeriod: 'annual',
      trialDays: 7,
      trialPoints: 10,
      costs: { invoicePromo: 1, invoiceStandard: 2, receipt: 1 },
      plans: [],
      addons: [],
    });
    (fetchSubscription as jest.Mock).mockResolvedValue({
      status: 'ACTIVE',
      plan: { code: 'STARTER', name: 'Starter', nameAr: 'ستارتر', documentQuota: 1, branchQuota: 1, deviceQuota: 1, selfServe: true, includedPoints: 10 },
      graceEndsAt: null,
      entitlements: { documentQuota: 1, branchQuota: 1, deviceQuota: 1, overrideActive: false },
      accessMode: 'FULL',
      pointsBalance: 42,
    });
    (fetchQuotas as jest.Mock).mockResolvedValue({
      period: { timezone: 'Africa/Cairo', monthStart: '2026-08-01', monthEnd: '2026-08-31' },
      documents: { used: 3, limit: 10 },
      branches: { used: 1, limit: 2 },
      devices: { used: 0, limit: 1 },
      entitlements: { planCode: 'STARTER', documentQuota: 10, branchQuota: 2, deviceQuota: 1, overrideActive: false },
    });
    (fetchInvoices as jest.Mock).mockResolvedValue({ items: [] });
  });

  it('keeps the existing billing query keys', async () => {
    const { qc } = renderPage();
    expect(await screen.findByText('Starter')).toBeInTheDocument();
    await waitFor(() => {
      const keys = qc.getQueryCache().findAll().map((q) => q.queryKey);
      expect(keys).toEqual(
        expect.arrayContaining([
          ['billing-catalog'],
          ['billing-subscription'],
          ['billing-quotas'],
          ['billing-invoices'],
        ]),
      );
    });
  });

  it('shows invoice skeleton instead of empty while loading', () => {
    (fetchInvoices as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.billing.noInvoices)).not.toBeInTheDocument();
  });

  it('shows empty invoices when the list is empty', async () => {
    renderPage();
    expect(await screen.findByText(en.billing.noInvoices)).toBeInTheDocument();
  });

  it('renders invoice amount from amountCents / 100', async () => {
    (fetchInvoices as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'inv-1',
          provider: 'manual',
          providerInvoiceId: 'p-1',
          status: 'PAID',
          amountCents: 12345,
          currency: 'egp',
          hostedInvoiceUrl: 'https://example.test/inv',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/123\.45 EGP/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('PAID')).toHaveAttribute('dir', 'ltr');
  });

  it('retries a failed subscription load', async () => {
    (fetchSubscription as jest.Mock)
      .mockRejectedValueOnce(new ApiError('down', 500))
      .mockResolvedValueOnce({
        status: 'ACTIVE',
        plan: { code: 'STARTER', name: 'Starter', nameAr: 'ستارتر', documentQuota: 1, branchQuota: 1, deviceQuota: 1, selfServe: true, includedPoints: 10 },
        graceEndsAt: null,
        entitlements: { documentQuota: 1, branchQuota: 1, deviceQuota: 1, overrideActive: false },
        accessMode: 'FULL',
        pointsBalance: 42,
      });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.billing.retryLoad }));
    expect(await screen.findByText('Starter')).toBeInTheDocument();
  });

  it('keeps Arabic chrome RTL while points stay LTR', async () => {
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: ar.billing.title })).toBeInTheDocument();
    expect(await screen.findByText('42')).toHaveAttribute('dir', 'ltr');
  });

  it('does not invent cancellation or payment-method controls', async () => {
    renderPage();
    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/payment method/i)).not.toBeInTheDocument();
  });
});
