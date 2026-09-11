import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { fetchAnalyticsSummary } from '@/lib/api/analytics';
import { getCompanyProfile } from '@/lib/api/company';
import { listDocuments } from '@/lib/api/documents';
import { getEtaCredentials, getEtaSetupStatus } from '@/lib/api/eta-credentials';
import { getEtaEnvironment } from '@/lib/api/eta-environment';
import { listMembers } from '@/lib/api/members';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import HomePage from './page';
import {
  cairoTodayIso,
  deltaDirection,
  monthOverMonthRatio,
  monthToDateRange,
  previousMonthToDate,
} from './_components/dashboard-dates';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ locale: 'en' })),
}));

jest.mock('@/lib/auth-provider', () => ({
  useAuth: () => ({
    ready: true,
    logout: jest.fn(),
    user: {
      id: 'u1',
      email: 'owner@test.local',
      name: 'Mustafa Tariq',
      isPlatformOperator: false,
    },
  }),
}));

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    memberships: [
      {
        role: { name: 'Owner' },
        tenant: { id: 'tenant-1', name: 'Test Company', lifecycleStatus: 'ACTIVE' },
      },
    ],
    branches: [{ id: 'branch-1', name: 'Main' }],
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
    roleName: 'Owner',
  }),
}));

jest.mock('@/lib/api/eta-credentials', () => ({
  getEtaSetupStatus: jest.fn(),
  getEtaCredentials: jest.fn(),
}));

jest.mock('@/lib/api/eta-environment', () => ({
  getEtaEnvironment: jest.fn(),
}));

jest.mock('@/lib/api/analytics', () => ({
  fetchAnalyticsSummary: jest.fn(),
}));

jest.mock('@/lib/api/documents', () => ({
  listDocuments: jest.fn(),
}));

jest.mock('@/lib/api/company', () => ({
  getCompanyProfile: jest.fn(),
}));

jest.mock('@/lib/api/members', () => ({
  listMembers: jest.fn(),
}));

const CURRENT_TOTALS = {
  issued: 42,
  received: 5,
  valid: 40,
  invalid: 2,
  api_calls: 9,
  storage_bytes: 100,
};

const PREVIOUS_TOTALS = {
  issued: 30,
  received: 4,
  valid: 28,
  invalid: 3,
  api_calls: 7,
  storage_bytes: 80,
};

function summaryPayload(
  from: string,
  to: string,
  totals: typeof CURRENT_TOTALS,
) {
  return {
    from,
    to,
    timezone: 'Africa/Cairo',
    asOf: '2026-09-11T00:00:00.000Z',
    filters: { branchId: null, currencyCode: null },
    totals,
    notes: [],
  };
}

function docItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    kind: 'I',
    status: 'VALID',
    origin: 'LOCAL',
    internalId: 'INV-00042',
    issueDateTime: '2026-09-01T10:00:00.000Z',
    currencyCode: 'EGP',
    totalAmount: '45200',
    receiverName: 'Al Noor',
    receiverId: 'recv-1',
    updatedAt: '2026-09-01T10:00:00.000Z',
    needsAttention: false,
    needsAttentionReason: null,
    submissionUuid: null,
    etaUuid: 'eta-1',
    etaLongId: null,
    etaStatus: 'valid',
    etaStatusUpdatedAt: '2026-09-01T10:00:00.000Z',
    submitInFlight: false,
    submitCooldownUntil: null,
    ...overrides,
  };
}

function renderDashboard(locale: 'en' | 'ar' = 'en') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const replace = jest.fn();
  const push = jest.fn();
  (useRouter as jest.Mock).mockReturnValue({ push, replace });
  const view = render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        <ThemeProvider>
          <HomePage />
        </ThemeProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...view, replace, push };
}

describe('dashboard dates', () => {
  it('builds a month-to-date range and a previous comparable window', () => {
    const current = monthToDateRange('2026-09-11');
    expect(current).toEqual({ from: '2026-09-01', to: '2026-09-11' });
    expect(previousMonthToDate(current)).toEqual({
      from: '2026-08-01',
      to: '2026-08-11',
    });
  });

  it('computes month-over-month from real totals only', () => {
    expect(monthOverMonthRatio(42, 30)).toBeCloseTo(0.4);
    expect(monthOverMonthRatio(42, 0)).toBeNull();
    expect(deltaDirection(0.4)).toBe('up');
    expect(deltaDirection(-0.1)).toBe('down');
    expect(deltaDirection(0)).toBe('flat');
  });
});

describe('home dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getEtaSetupStatus as jest.Mock).mockResolvedValue({
      etaConfigured: true,
      promptDismissed: false,
      promptEtaSetup: false,
      tutorialVideoUrl: null,
    });
    (getEtaEnvironment as jest.Mock).mockResolvedValue({
      activeEnvironment: 'SANDBOX',
      apiBaseUrl: 'https://eta.example',
    });
    (getEtaCredentials as jest.Mock).mockResolvedValue({
      lastValidatedAt: '2026-09-11T08:00:00.000Z',
      clientId: 'cid',
    });
    (fetchAnalyticsSummary as jest.Mock).mockImplementation(
      async ({ from, to }: { from: string; to: string }) => {
        const current = monthToDateRange(cairoTodayIso());
        const totals =
          from === current.from && to === current.to
            ? CURRENT_TOTALS
            : PREVIOUS_TOTALS;
        return summaryPayload(from, to, totals);
      },
    );
    (listDocuments as jest.Mock).mockResolvedValue({
      items: [
        docItem(),
        docItem({
          id: 'doc-2',
          internalId: 'INV-00041',
          status: 'SUBMITTED',
          etaStatus: 'submitted',
          receiverName: 'Salam Co',
          totalAmount: '12850',
        }),
      ],
      nextCursor: null,
    });
    (getCompanyProfile as jest.Mock).mockResolvedValue({
      workspaceName: 'Test Company',
      legalName: 'Test Company LLC',
    });
    (listMembers as jest.Mock).mockResolvedValue([
      { id: 'm1', user: { id: 'u1', email: 'owner@test.local', name: 'Mustafa' }, role: { id: 'r1', name: 'Owner' } },
    ]);
  });

  it('redirects to ETA credentials when promptEtaSetup is true', async () => {
    (getEtaSetupStatus as jest.Mock).mockResolvedValue({
      etaConfigured: false,
      promptDismissed: false,
      promptEtaSetup: true,
      tutorialVideoUrl: null,
    });
    const { replace } = renderDashboard();
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/en/settings/eta-credentials');
    });
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
    expect(fetchAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('shows skeleton while ETA setup status is loading', () => {
    (getEtaSetupStatus as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByTestId('dashboard-gate-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  it('renders header, KPIs from analytics, quick actions, activity, ETA, and checklist', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-kpi-issued')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /Welcome, Mustafa/ })).toBeInTheDocument();
    expect(screen.getByText(/Test Company/)).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-quick-import')).toHaveTextContent('Import CSV');
    expect(screen.getByTestId('dashboard-quick-new')).toHaveTextContent('New document');

    const issued = screen.getByTestId('dashboard-kpi-issued');
    expect(within(issued).getByText('Documents this month')).toBeInTheDocument();
    expect(within(issued).getByText('42')).toBeInTheDocument();
    expect(within(issued).getByText('40.0% vs previous month')).toBeInTheDocument();

    const valid = screen.getByTestId('dashboard-kpi-valid');
    expect(within(valid).getByText('Valid')).toBeInTheDocument();
    expect(within(valid).getByText('40')).toBeInTheDocument();
    expect(within(valid).getByText('95.2% validity rate')).toBeInTheDocument();

    expect(within(screen.getByTestId('dashboard-kpi-received')).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('dashboard-kpi-invalid')).getByText('2')).toBeInTheDocument();

    expect(screen.queryByText('1,284')).not.toBeInTheDocument();
    expect(screen.queryByText('12.4%')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Submitted to ETA')).not.toBeInTheDocument();

    expect(screen.getByRole('table', { name: 'Recent documents' })).toBeInTheDocument();
    expect(screen.getByText('INV-00042')).toBeInTheDocument();
    expect(screen.getByText('Al Noor')).toBeInTheDocument();
    expect(screen.getByText('45,200.00')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-eta')).toHaveTextContent('Connected');
    });
    expect(screen.getByTestId('dashboard-eta')).toHaveTextContent('Sandbox');
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-checklist')).toHaveTextContent('3 of 4 steps complete');
    });

    const current = monthToDateRange(cairoTodayIso());
    expect(fetchAnalyticsSummary).toHaveBeenCalledWith({
      from: current.from,
      to: current.to,
    });
    expect(listDocuments).toHaveBeenCalledWith({
      limit: 5,
      sortBy: 'issueDateTime',
      sortDir: 'desc',
    });
  });

  it('shows KPI skeletons while analytics is loading', async () => {
    (fetchAnalyticsSummary as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('dashboard-stats-loading')).toBeInTheDocument();
  });

  it('shows EmptyState when there are no documents', async () => {
    (listDocuments as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    (fetchAnalyticsSummary as jest.Mock).mockImplementation(
      async ({ from, to }: { from: string; to: string }) =>
        summaryPayload(from, to, { ...CURRENT_TOTALS, issued: 0, valid: 0, invalid: 0, received: 0 }),
    );
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('No documents yet')).toBeInTheDocument();
    });
  });

  it('shows an error state when analytics fails', async () => {
    (fetchAnalyticsSummary as jest.Mock).mockRejectedValue(new Error('nope'));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-stats-error')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load dashboard metrics');
  });

  it('shows an error state when recent documents fail', async () => {
    (listDocuments as jest.Mock).mockRejectedValue(new Error('nope'));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-activity-error')).toBeInTheDocument();
    });
  });

  it('omits month-over-month copy when previous analytics is missing', async () => {
    (fetchAnalyticsSummary as jest.Mock).mockImplementation(
      async ({ from, to }: { from: string; to: string }) => {
        const current = monthToDateRange(cairoTodayIso());
        if (from === current.from && to === current.to) {
          return summaryPayload(from, to, CURRENT_TOTALS);
        }
        throw new Error('previous unavailable');
      },
    );
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-kpi-issued')).toBeInTheDocument();
    });
    expect(screen.queryByText(/vs previous month/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('dashboard-kpi-issued')).getByText('42')).toBeInTheDocument();
  });

  it('navigates quick actions to existing routes', async () => {
    const { push } = renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-quick-import')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('dashboard-quick-import'));
    expect(push).toHaveBeenCalledWith('/en/imports');
    fireEvent.click(screen.getByTestId('dashboard-quick-new'));
    expect(push).toHaveBeenCalledWith('/en/documents/new');
  });

  it('renders Arabic copy and a direction-aware view-all control', async () => {
    renderDashboard('ar');
    await waitFor(() => {
      expect(screen.getByText('مستندات الشهر')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /مرحبًا، Mustafa/ })).toBeInTheDocument();
    expect(screen.getAllByText('آخر المستندات').length).toBeGreaterThan(0);
    expect(screen.getByTestId('dashboard-quick-new')).toHaveTextContent('مستند جديد');
    const viewAll = screen.getByRole('button', { name: 'عرض الكل' });
    expect(viewAll.querySelector('.rtl\\:rotate-180')).not.toBeNull();
  });
});
