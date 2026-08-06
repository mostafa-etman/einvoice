import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

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
  fetchAnalyticsSummary: jest.fn(async () => ({
    from: '2026-08-01',
    to: '2026-08-01',
    timezone: 'Africa/Cairo',
    asOf: new Date().toISOString(),
    filters: { branchId: null, currencyCode: null },
    totals: {
      issued: 2,
      received: 1,
      valid: 2,
      invalid: 0,
      api_calls: 3,
      storage_bytes: 100,
    },
    notes: [],
  })),
  fetchAnalyticsSeries: jest.fn(async () => ({
    grain: 'day',
    timezone: 'Africa/Cairo',
    points: [
      {
        bucket: '2026-08-01',
        values: {
          issued: 2,
          received: 1,
          valid: 2,
          invalid: 0,
          api_calls: 3,
          storage_bytes: 100,
        },
      },
    ],
  })),
  fetchBranchesForFilter: jest.fn(async () => []),
  createAnalyticsExport: jest.fn(),
  downloadAnalyticsExport: jest.fn(),
}));

import AnalyticsPage from './page';

const messages = {
  analytics: {
    title: 'Usage analytics',
    subtitle: 'Organization metering from daily rollups',
    from: 'From',
    to: 'To',
    branch: 'Branch',
    currency: 'Currency',
    grain: 'Chart grain',
    grainDay: 'Daily',
    grainMonth: 'Monthly',
    allBranches: 'All branches',
    refresh: 'Refresh',
    loading: 'Loading…',
    error: 'Could not load analytics',
    exportError: 'Export failed',
    exportCsv: 'Export CSV',
    exportXlsx: 'Export XLSX',
    asOf: 'As of {asOf}',
    chartDocuments: 'Documents over time',
    chartApi: 'API calls',
    chartStorage: 'Storage bytes',
    meters: {
      issued: 'Issued',
      received: 'Received',
      valid: 'Valid',
      invalid: 'Invalid',
      api_calls: 'API calls',
      storage_bytes: 'Storage (bytes)',
    },
  },
};

describe('Analytics page smoke', () => {
  it('renders meters and charts', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AnalyticsPage />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText('Usage analytics')).toBeInTheDocument();
    expect(await screen.findByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
    expect(screen.getByText('Export XLSX')).toBeInTheDocument();
    expect(screen.getAllByTestId('chart').length).toBeGreaterThan(0);
  });
});
