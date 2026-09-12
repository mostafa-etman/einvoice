import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { fetchReport, downloadReportExport, fetchBranchesForFilter } from '@/lib/api/reports';
import ReportDetailPage from './page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ reportId: 'C4' }),
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

const c4Payload = {
  reportId: 'C4',
  filters: {},
  summary: { salesValue: '100', outputVat: '14', netVat: '14' },
  taxTypes: ['T1', 'T4', 'T99'],
  sections: {
    output: [
      {
        side: 'output',
        taxType: 'T1',
        taxTypeNameEn: 'Value added tax',
        taxTypeNameAr: 'ضريبة القيمة المضافة',
        subType: 'V009',
        subTypeNameEn: 'Standard rate',
        subTypeNameAr: 'سعر عام',
        rate: '14',
        taxableValue: '100.00',
        taxAmount: '14.00',
        documentCount: 1,
      },
      {
        side: 'output',
        taxType: 'T99',
        taxTypeNameEn: null,
        taxTypeNameAr: null,
        subType: 'X',
        rate: '0',
        taxableValue: '0.00',
        taxAmount: '0.00',
        documentCount: 0,
      },
    ],
    withholding: [
      {
        side: 'output',
        category: 'withholding',
        taxType: 'T4',
        taxTypeNameEn: 'Withholding tax (WHT)',
        taxTypeNameAr: 'الخصم تحت حساب الضريبه',
        subType: 'W001',
        rate: '5',
        taxableValue: '50.00',
        taxAmount: '2.50',
        documentCount: 1,
      },
    ],
  },
  rows: [],
};

function renderC4(locale: 'en' | 'ar') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ar' ? ar : en}
    >
      <ReportDetailPage />
    </NextIntlClientProvider>,
  );
}

describe('C4 tax type labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchBranchesForFilter as jest.Mock).mockResolvedValue([]);
    (fetchReport as jest.Mock).mockResolvedValue(c4Payload);
    (downloadReportExport as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows Arabic tax type names instead of T1/T4 codes', async () => {
    renderC4('ar');
    expect(
      await screen.findByRole('option', { name: 'ضريبة القيمة المضافة' }),
    ).toHaveValue('T1');
    expect(screen.getAllByText('ضريبة القيمة المضافة').length).toBeGreaterThan(1);
    expect(screen.getAllByText('الخصم تحت حساب الضريبه').length).toBeGreaterThan(0);
    expect(screen.queryByText('(T1)')).not.toBeInTheDocument();
  });

  it('shows English tax type names when the locale is English', async () => {
    renderC4('en');
    expect(await screen.findByRole('option', { name: 'Value added tax' })).toHaveValue(
      'T1',
    );
    expect(screen.getAllByText('Value added tax').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Withholding tax (WHT)').length).toBeGreaterThan(0);
    expect(screen.queryByText('(T1)')).not.toBeInTheDocument();
  });

  it('falls back to the stored code for unknown tax types', async () => {
    renderC4('ar');
    expect(await screen.findByRole('option', { name: 'T99' })).toHaveValue('T99');
    expect(screen.getAllByText('T99').length).toBeGreaterThan(0);
  });
});
