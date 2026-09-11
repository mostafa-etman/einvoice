import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { fetchReport, downloadReportExport, fetchBranchesForFilter } from '@/lib/api/reports';
import ReportsHubPage from './page';
import ReportDetailPage from './[reportId]/page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ reportId: 'S1' }),
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

jest.mock('@/lib/api/reports', () => {
  const actual = jest.requireActual('@/lib/api/reports');
  return {
    ...actual,
    fetchReport: jest.fn(),
    downloadReportExport: jest.fn(),
    fetchBranchesForFilter: jest.fn(),
  };
});

function renderHub() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ReportsHubPage />
    </NextIntlClientProvider>,
  );
}

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ReportDetailPage />
    </NextIntlClientProvider>,
  );
}

describe('reports hub', () => {
  it('links to existing report ids without inventing extra reports', () => {
    renderHub();
    expect(screen.getByRole('heading', { level: 1, name: en.reports.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /S1 — Total sales/i })).toHaveAttribute(
      'href',
      '/en/reports/S1',
    );
    expect(screen.getByRole('link', { name: /C1 — NET VAT position/i })).toHaveAttribute(
      'href',
      '/en/reports/C1',
    );
  });
});

describe('report detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchBranchesForFilter as jest.Mock).mockResolvedValue([]);
    (fetchReport as jest.Mock).mockResolvedValue({
      reportId: 'S1',
      filters: {},
      summary: { net: 100, documentCount: 2 },
      rows: [{ bucket: '2026-08', net: 100 }],
      chart: { data: [{ bucket: '2026-08', net: 100 }] },
    });
    (downloadReportExport as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows a skeleton instead of results while the first request is in flight', () => {
    (fetchReport as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderDetail();
    expect(screen.queryByText(en.reports.emptyResults)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('fetches S1 with month grain and date filters', async () => {
    renderDetail();
    await waitFor(() => expect(fetchReport).toHaveBeenCalled());
    expect(fetchReport).toHaveBeenCalledWith(
      'S1',
      expect.objectContaining({
        grain: 'month',
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        showGross: false,
        includeNonFinancialStatuses: false,
        perBranch: false,
      }),
    );
  });

  it('exports CSV with the same filters payload', async () => {
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: /S1 — Total sales/i });
    fireEvent.click(screen.getByRole('button', { name: en.reports.exportCsv }));
    await waitFor(() => {
      expect(downloadReportExport).toHaveBeenCalledWith(
        'S1',
        'CSV',
        expect.objectContaining({ grain: 'month' }),
      );
    });
  });

  it('retries a failed report load', async () => {
    (fetchReport as jest.Mock)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        reportId: 'S1',
        filters: {},
        summary: { net: 100 },
        rows: [{ bucket: '2026-08', net: 100 }],
      });
    renderDetail();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.reports.error);
    fireEvent.click(screen.getByRole('button', { name: en.reports.retryLoad }));
    await waitFor(() => expect(fetchReport).toHaveBeenCalledTimes(2));
  });
});
