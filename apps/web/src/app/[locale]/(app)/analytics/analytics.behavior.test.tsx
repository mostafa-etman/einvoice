import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import {
  createAnalyticsExport,
  downloadAnalyticsExport,
  fetchAnalyticsSeries,
  fetchAnalyticsSummary,
  fetchBranchesForFilter,
} from '@/lib/api/analytics';
import AnalyticsPage from './page';

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

jest.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  );
  return {
    ResponsiveContainer: Passthrough,
    BarChart: Passthrough,
    LineChart: Passthrough,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

jest.mock('@/lib/api/analytics', () => ({
  fetchAnalyticsSummary: jest.fn(),
  fetchAnalyticsSeries: jest.fn(),
  fetchBranchesForFilter: jest.fn(),
  createAnalyticsExport: jest.fn(),
  downloadAnalyticsExport: jest.fn(),
}));

const summary = {
  from: '2026-08-01',
  to: '2026-08-31',
  timezone: 'Africa/Cairo',
  asOf: '2026-08-31T12:00:00.000Z',
  filters: { branchId: null, currencyCode: null },
  totals: {
    issued: 12,
    received: 4,
    valid: 10,
    invalid: 2,
    api_calls: 8,
    storage_bytes: 2048,
  },
  notes: [],
};

function renderPage(locale: 'en' | 'ar' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <AnalyticsPage />
    </NextIntlClientProvider>,
  );
}

describe('analytics page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchBranchesForFilter as jest.Mock).mockResolvedValue([]);
    (fetchAnalyticsSummary as jest.Mock).mockResolvedValue(summary);
    (fetchAnalyticsSeries as jest.Mock).mockResolvedValue({
      grain: 'day',
      timezone: 'Africa/Cairo',
      points: [
        {
          bucket: '2026-08-01',
          values: summary.totals,
        },
      ],
    });
    (createAnalyticsExport as jest.Mock).mockResolvedValue({
      id: 'exp-1',
      status: 'READY',
      format: 'CSV',
    });
    (downloadAnalyticsExport as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders real meter totals as LTR values', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: en.analytics.title })).toBeInTheDocument();
    expect(await screen.findByText(en.analytics.meters.issued)).toBeInTheDocument();
    expect(screen.getByText('12')).toHaveAttribute('dir', 'ltr');
    expect(document.querySelector('[data-meter="issued"]')).toBeTruthy();
  });

  it('shows a skeleton instead of meters while the first request is in flight', () => {
    (fetchAnalyticsSummary as jest.Mock).mockImplementation(() => new Promise(() => {}));
    (fetchAnalyticsSeries as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.analytics.meters.issued)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('loads summary and series with date filters and grain', async () => {
    renderPage();
    await screen.findByText(en.analytics.meters.issued);
    await waitFor(() => {
      expect(fetchAnalyticsSummary).toHaveBeenCalled();
      expect(fetchAnalyticsSeries).toHaveBeenCalled();
    });
    const summaryArg = (fetchAnalyticsSummary as jest.Mock).mock.calls[0][0];
    const seriesArg = (fetchAnalyticsSeries as jest.Mock).mock.calls[0][0];
    expect(summaryArg).toEqual(
      expect.objectContaining({
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        branchId: undefined,
        currencyCode: undefined,
      }),
    );
    expect(seriesArg).toEqual(
      expect.objectContaining({
        grain: 'day',
        from: summaryArg.from,
        to: summaryArg.to,
      }),
    );
  });

  it('exports CSV with the existing payload', async () => {
    renderPage();
    await screen.findByText(en.analytics.meters.issued);
    fireEvent.click(screen.getByRole('button', { name: en.analytics.exportCsv }));
    await waitFor(() => {
      expect(createAnalyticsExport).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'CSV',
          grain: 'day',
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });
  });

  it('retries a failed analytics load', async () => {
    (fetchAnalyticsSummary as jest.Mock)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(summary);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.analytics.retryLoad }));
    expect(await screen.findByText(en.analytics.meters.issued)).toBeInTheDocument();
  });

  it('keeps Arabic chrome RTL while meter values stay LTR', async () => {
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: ar.analytics.title })).toBeInTheDocument();
    expect(await screen.findByText('12')).toHaveAttribute('dir', 'ltr');
  });
});
