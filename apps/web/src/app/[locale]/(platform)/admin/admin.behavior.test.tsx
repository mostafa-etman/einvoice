import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import { ApiError } from '@/lib/api/client';
import {
  activateTenant,
  approveTenant,
  getTenant,
  getTenantUsage,
  listAdminPlans,
  listTenants,
  provisionTenant,
  rejectTenant,
  startImpersonation,
  suspendTenant,
  type TenantSummary,
} from '@/lib/api/platform-admin';
import PlatformAdminPage from './page';

jest.mock('@/lib/api/platform-admin', () => {
  const actual = jest.requireActual('@/lib/api/platform-admin');
  return {
    ...actual,
    listTenants: jest.fn(),
    listAdminPlans: jest.fn(),
    listAdminAddons: jest.fn(),
    getDocumentCosts: jest.fn(),
    getSettings: jest.fn(),
    listTrialTaxRegistrations: jest.fn(),
    provisionTenant: jest.fn(),
    getTenant: jest.fn(),
    getTenantUsage: jest.fn(),
    approveTenant: jest.fn(),
    rejectTenant: jest.fn(),
    suspendTenant: jest.fn(),
    activateTenant: jest.fn(),
    assignPlan: jest.fn(),
    adjustPoints: jest.fn(),
    applyAddon: jest.fn(),
    startImpersonation: jest.fn(),
    breakGlass: jest.fn(),
    endImpersonation: jest.fn(),
    upsertPlan: jest.fn(),
    setPlanActive: jest.fn(),
    upsertAddon: jest.fn(),
    setDocumentCosts: jest.fn(),
    updateSettings: jest.fn(),
    resetTrialTaxRegistration: jest.fn(),
  };
});

function tenant(overrides: Partial<TenantSummary> = {}): TenantSummary {
  return {
    id: 'tenant-1',
    name: 'Acme Co',
    planCode: 'BASIC',
    status: 'ACTIVE',
    lifecycleStatus: 'PENDING',
    activationStatus: 'PENDING',
    suspendedAt: null,
    pointsBalance: 12,
    createdAt: '2026-08-01T00:00:00.000Z',
    ownerEmail: 'owner@acme.test',
    ...overrides,
  };
}

function renderPage(locale: 'en' | 'ar' = 'en') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
          <PlatformAdminPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('platform admin page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listTenants as jest.Mock).mockResolvedValue({ items: [tenant()], nextCursor: null });
    (listAdminPlans as jest.Mock).mockResolvedValue({
      plans: [
        {
          id: 'plan-1',
          code: 'BASIC',
          nameEn: 'Basic',
          nameAr: 'أساسي',
          descriptionEn: null,
          descriptionAr: null,
          documentQuota: 500,
          branchQuota: 1,
          deviceQuota: 1,
          includedPoints: 10,
          officialPriceEgp: 400,
          discountedPriceEgp: 250,
          maxUsers: 1,
          maxCompanies: 1,
          isTrial: false,
          isPublic: true,
          selfServe: true,
          isActive: true,
          sortOrder: 0,
        },
      ],
    });
    (approveTenant as jest.Mock).mockResolvedValue(tenant({ lifecycleStatus: 'ACTIVE' }));
    (rejectTenant as jest.Mock).mockResolvedValue(tenant({ lifecycleStatus: 'REJECTED' }));
    (suspendTenant as jest.Mock).mockResolvedValue(tenant({ lifecycleStatus: 'SUSPENDED' }));
    (activateTenant as jest.Mock).mockResolvedValue(tenant({ lifecycleStatus: 'ACTIVE' }));
    (provisionTenant as jest.Mock).mockResolvedValue(tenant());
    (getTenant as jest.Mock).mockResolvedValue({
      ...tenant({ lifecycleStatus: 'ACTIVE' }),
      ownerId: 'user-1',
      graceEndsAt: null,
      entitlements: {
        planCode: 'BASIC',
        documentQuota: 500,
        branchQuota: 1,
        deviceQuota: 1,
        overrideActive: false,
      },
    });
    (getTenantUsage as jest.Mock).mockResolvedValue({
      quotas: {
        documents: { used: 1, limit: 500 },
        branches: { used: 1, limit: 1 },
        devices: { used: 0, limit: 1 },
      },
      meters: {
        period: { from: '2026-08-01', to: '2026-08-31', monthKey: '2026-08', timezone: 'Africa/Cairo' },
        documents: 1,
        branches: 1,
        devices: 0,
      },
      pointsBalance: 12,
      pointsLedger: { items: [], nextCursor: null, consumedOnPage: 0 },
    });
    (startImpersonation as jest.Mock).mockResolvedValue({
      id: 'sess-1',
      tenantId: 'tenant-1',
      targetUserId: 'user-1',
      mode: 'READ_ONLY',
      reason: 'support',
      expiresAt: '2026-08-01T01:00:00.000Z',
      accessToken: 'token',
    });
  });

  it('keeps the existing platform-admin query keys', async () => {
    const { qc } = renderPage();
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    await waitFor(() => {
      const keys = qc.getQueryCache().findAll().map((q) => q.queryKey);
      expect(keys).toEqual(
        expect.arrayContaining([
          ['platform-admin-tenants', '', ''],
          ['platform-admin-plans'],
        ]),
      );
    });
  });

  it('shows a skeleton instead of empty while tenants are loading', () => {
    (listTenants as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.admin.empty)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows empty tenants after load', async () => {
    (listTenants as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText(en.admin.empty)).toBeInTheDocument();
  });

  it('shows a dedicated 403 state without retry', async () => {
    (listTenants as jest.Mock).mockRejectedValue(new ApiError('forbidden', 403));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: en.admin.title })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.admin.accessDenied);
    expect(screen.queryByRole('button', { name: en.admin.retryLoad })).not.toBeInTheDocument();
  });

  it('retries a non-403 tenant load error', async () => {
    (listTenants as jest.Mock)
      .mockRejectedValueOnce(new ApiError('down', 500))
      .mockResolvedValueOnce({ items: [tenant()], nextCursor: null });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.admin.retryLoad }));
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
  });

  it('approves a pending tenant with the existing reason payload after confirm', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.admin.approve }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.admin.approve }));
    await waitFor(() => expect(approveTenant).toHaveBeenCalledWith('tenant-1', 'ui'));
  });

  it('rejects a pending tenant with the typed reason', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.admin.reject }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.admin.reason), {
      target: { value: 'incomplete' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.admin.reject }));
    await waitFor(() => expect(rejectTenant).toHaveBeenCalledWith('tenant-1', 'incomplete'));
  });

  it('suspends an active tenant with a reason', async () => {
    (listTenants as jest.Mock).mockResolvedValue({
      items: [tenant({ lifecycleStatus: 'ACTIVE' })],
      nextCursor: null,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.admin.suspend }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.admin.reason), { target: { value: 'abuse' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.admin.suspend }));
    await waitFor(() => expect(suspendTenant).toHaveBeenCalledWith('tenant-1', 'abuse'));
  });

  it('reactivates a suspended tenant without a confirmation step', async () => {
    (listTenants as jest.Mock).mockResolvedValue({
      items: [tenant({ lifecycleStatus: 'SUSPENDED' })],
      nextCursor: null,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.admin.activate }));
    await waitFor(() => expect(activateTenant).toHaveBeenCalledWith('tenant-1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('provisions a tenant with the existing payload', async () => {
    renderPage();
    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.admin.provision }));
    expect(await screen.findByRole('heading', { name: en.admin.provisionTitle })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/tenant name/i), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByLabelText(/owner email/i), {
      target: { value: 'new@co.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.admin.create }));
    await waitFor(() =>
      expect(provisionTenant).toHaveBeenCalledWith({
        name: 'New Co',
        ownerEmail: 'new@co.test',
        ownerName: '',
        planCode: 'BASIC',
        reason: '',
      }),
    );
  });

  it('opens tenant details and impersonates with the existing payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.admin.viewDetails }));
    expect(await screen.findByText(en.admin.detailsTitle)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: en.admin.impersonate }));
    const modal = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.change(within(modal).getByLabelText(en.admin.reason), { target: { value: 'support' } });
    fireEvent.click(within(modal).getByRole('button', { name: en.admin.impersonate }));
    await waitFor(() =>
      expect(startImpersonation).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        targetUserId: 'user-1',
        reason: 'support',
      }),
    );
  });

  it('does not invent Users, ETA schema, or Audit log tabs', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: en.admin.tabTenants })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: en.admin.tabPlans })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: en.admin.tabTrials })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /audit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^users$/i })).not.toBeInTheDocument();
  });

  it('keeps Arabic chrome RTL while tenant ids stay LTR', async () => {
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: ar.admin.title })).toBeInTheDocument();
    expect(await screen.findByText('owner@acme.test')).toHaveAttribute('dir', 'ltr');
  });
});
