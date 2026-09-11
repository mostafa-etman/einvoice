import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import SettingsHubPage from './page';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    memberships: [],
    branches: [],
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
    roleName: 'Owner',
  }),
}));

function renderHub(locale: 'en' | 'ar') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <SettingsHubPage />
    </NextIntlClientProvider>,
  );
}

describe('settings hub', () => {
  it('renders grouped navigation with existing routes in English', () => {
    renderHub('en');
    expect(screen.getByTestId('settings-hub')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: en.settings.groupCompany })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: en.settings.groupEta })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: en.settings.groupCatalog })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: new RegExp(en.settings.company) })).toHaveAttribute(
      'href',
      '/en/settings/company',
    );
    expect(screen.getByRole('link', { name: new RegExp(en.settings.branches) })).toHaveAttribute(
      'href',
      '/en/settings/branches',
    );
    expect(
      screen.getByRole('link', { name: new RegExp(en.settings.invoiceNumbering) }),
    ).toHaveAttribute('href', '/en/settings/invoice-numbering');
    expect(screen.getByRole('link', { name: new RegExp(en.settings.eta) })).toHaveAttribute(
      'href',
      '/en/settings/eta-credentials',
    );
    expect(
      screen.getByRole('link', { name: new RegExp(en.settings.etaDocumentTypes) }),
    ).toHaveAttribute('href', '/en/settings/eta-document-types');
    expect(screen.getByRole('link', { name: new RegExp(en.settings.currencies) })).toHaveAttribute(
      'href',
      '/en/settings/currencies',
    );
    expect(screen.getByRole('link', { name: new RegExp(en.settings.itemCodes) })).toHaveAttribute(
      'href',
      '/en/settings/item-codes',
    );
  });

  it('renders grouped navigation in Arabic', () => {
    renderHub('ar');
    expect(screen.getByRole('heading', { level: 2, name: ar.settings.groupCompany })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: ar.settings.groupEta })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: ar.settings.groupCatalog })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(ar.settings.company) })).toHaveAttribute(
      'href',
      '/ar/settings/company',
    );
    expect(screen.getByRole('link', { name: new RegExp(ar.settings.eta) })).toHaveAttribute(
      'href',
      '/ar/settings/eta-credentials',
    );
  });
});
