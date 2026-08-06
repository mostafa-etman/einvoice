import { render, screen } from '@testing-library/react';
import ReportsHubPage from './page';

jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      title: 'Business reports',
      subtitle: 'Sales, purchases, and tax reports',
      vsAnalytics: 'Usage Analytics is separate',
      'groups.sales': 'Sales',
      'groups.purchases': 'Purchases',
      'groups.combined': 'Combined / tax',
      'catalog.S1.name': 'Total sales',
      'catalog.S1.desc': 'Netted sales',
      'catalog.S2.name': 'Sales by customer',
      'catalog.S2.desc': 'Top receivers',
      'catalog.S3.name': 'Sales by item',
      'catalog.S3.desc': 'By item',
      'catalog.S4.name': 'Output VAT',
      'catalog.S4.desc': 'VAT out',
      'catalog.P1.name': 'Total purchases',
      'catalog.P1.desc': 'Netted purchases',
      'catalog.P2.name': 'Purchases by supplier',
      'catalog.P2.desc': 'Top suppliers',
      'catalog.P3.name': 'Input VAT',
      'catalog.P3.desc': 'VAT in',
      'catalog.C1.name': 'NET VAT position',
      'catalog.C1.desc': 'Output − input',
      'catalog.C2.name': 'Sales vs purchases',
      'catalog.C2.desc': 'Comparison',
      'catalog.C3.name': 'Document status',
      'catalog.C3.desc': 'Status overview',
    };
    return map[key] ?? key;
  },
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe('Reports hub smoke', () => {
  it('lists NET VAT and sales reports', async () => {
    render(<ReportsHubPage />);
    expect(await screen.findByText('Business reports')).toBeInTheDocument();
    expect(screen.getByText(/C1 — NET VAT position/i)).toBeInTheDocument();
    expect(screen.getByText(/S1 — Total sales/i)).toBeInTheDocument();
  });
});
