import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ToastProvider } from '@/components/ui/toast';
import { createTenant } from '@/lib/api/tenants';
import { ApiError } from '@/lib/api/client';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import CreateCompanyPage from './page';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/companies/new'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ locale: 'en' })),
}));

jest.mock('@/lib/api/tenants', () => ({
  createTenant: jest.fn(),
}));

function renderPage(locale: 'en' | 'ar' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        <ToastProvider>
          <CreateCompanyPage />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('create company (existing account owner)', () => {
  beforeEach(() => {
    (createTenant as jest.Mock).mockReset();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn() });
  });

  it('shows company details without plan selection and inherits the account plan', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn() });
    (createTenant as jest.Mock).mockResolvedValue({
      id: 't2',
      name: 'Branch Co',
      activationStatus: 'ACTIVE',
    });

    renderPage('en');
    expect(screen.getByRole('heading', { name: en.shell.createCompanyTitle })).toBeInTheDocument();
    expect(screen.getByText(en.shell.createCompanyHint)).toBeInTheDocument();
    expect(screen.queryByText(en.auth.choosePlan)).not.toBeInTheDocument();
    expect(screen.queryByText(en.billing.startFreeTrial)).not.toBeInTheDocument();
    expect(screen.queryByText(en.billing.subscribeWhatsApp)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(en.auth.tenantName), { target: { value: 'Branch Co' } });
    fireEvent.click(screen.getByRole('button', { name: en.shell.createCompany }));

    await waitFor(() =>
      expect(createTenant).toHaveBeenCalledWith('Branch Co', { taxRegistrationNumber: undefined }),
    );
    expect(createTenant).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ planCode: expect.anything() }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/settings/eta-credentials'));
  });

  it('renders Arabic copy without a plan picker', () => {
    renderPage('ar');
    expect(screen.getByRole('heading', { name: ar.shell.createCompanyTitle })).toBeInTheDocument();
    expect(screen.getByText(ar.shell.createCompanyHint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ar.shell.createCompany })).toBeInTheDocument();
    expect(screen.queryByText(ar.auth.choosePlan)).not.toBeInTheDocument();
  });

  it('shows the company-limit WhatsApp message when the account is at max companies', async () => {
    (createTenant as jest.Mock).mockRejectedValue(
      new ApiError('Company limit reached (1/1). Upgrade via WhatsApp', 409, {
        code: 'COMPANY_LIMIT_EXCEEDED',
        whatsappUrl: 'https://wa.me/201000864620',
      }),
    );
    renderPage('en');
    fireEvent.change(screen.getByLabelText(en.auth.tenantName), { target: { value: 'Overflow Co' } });
    fireEvent.click(screen.getByRole('button', { name: en.shell.createCompany }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Company limit reached');
    expect(screen.getByRole('link', { name: en.shell.createCompanyLimitWhatsApp })).toHaveAttribute(
      'href',
      'https://wa.me/201000864620',
    );
    expect(createTenant).toHaveBeenCalledWith('Overflow Co', { taxRegistrationNumber: undefined });
  });
});
