import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthLayout } from '@/components/auth/auth-layout';
import LoginPage from './login/page';
import RegisterPage from './register/page';
import OnboardingPage from './onboarding/page';
import { establishTenantContext } from '@/lib/establish-tenant-context';
import { createTenant } from '@/lib/api/tenants';
import { fetchCatalog } from '@/lib/api/billing';
import { ApiError } from '@/lib/api/client';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

const mockLogin = jest.fn();
const mockRegister = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/login'),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  useParams: jest.fn(() => ({ locale: 'en' })),
}));

jest.mock('@/lib/auth-provider', () => ({
  useAuth: () => ({
    ready: true,
    user: null,
    login: mockLogin,
    register: mockRegister,
    logout: jest.fn(),
  }),
}));

jest.mock('@/lib/establish-tenant-context', () => ({
  establishTenantContext: jest.fn(async () => ({ needsOnboarding: false, promptEtaSetup: false })),
}));

jest.mock('@/lib/api/tenants', () => ({
  createTenant: jest.fn(),
}));

jest.mock('@/lib/api/billing', () => ({
  fetchCatalog: jest.fn(),
}));

const trialPlan = {
  code: 'TRIAL',
  name: 'Trial',
  nameAr: 'تجريبي',
  descriptionEn: null,
  descriptionAr: null,
  documentQuota: 50,
  branchQuota: 1,
  deviceQuota: 1,
  selfServe: true,
  includedPoints: 100,
  officialPriceEgp: 0,
  discountedPriceEgp: 0,
  savingsPercent: 0,
  maxUsers: 2,
  maxCompanies: 1,
  docCapacity: 50,
  isTrial: true,
  isPublic: true,
  currency: 'EGP' as const,
  billingPeriod: 'annual' as const,
  priceDisplay: null,
};

const paidPlan = {
  ...trialPlan,
  code: 'PRO',
  name: 'Pro',
  nameAr: 'احترافي',
  isTrial: false,
  officialPriceEgp: 12000,
  discountedPriceEgp: 9000,
  savingsPercent: 25,
};

function renderAuth(ui: ReactNode, locale: 'en' | 'ar' = 'en', pathname = `/${locale}/login`) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        <ThemeProvider>
          <AuthLayout>{ui}</AuthLayout>
        </ThemeProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('auth pages smoke', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockRegister.mockReset();
    (establishTenantContext as jest.Mock).mockReset();
    (establishTenantContext as jest.Mock).mockResolvedValue({ needsOnboarding: false, promptEtaSetup: false });
    (createTenant as jest.Mock).mockReset();
    (fetchCatalog as jest.Mock).mockReset();
    (fetchCatalog as jest.Mock).mockResolvedValue({
      trialDays: 7,
      trialPoints: 100,
      costs: { invoicePromo: 1, invoiceStandard: 2, receipt: 1 },
      plans: [trialPlan, paidPlan],
      addons: [],
    });
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn() });
    (usePathname as jest.Mock).mockReturnValue('/en/login');
  });

  it('exposes login/register/onboarding copy', () => {
    expect(en.auth.loginTitle).toBeTruthy();
    expect(en.auth.registerTitle).toBeTruthy();
    expect(en.auth.onboardingTitle).toBeTruthy();
    expect(en.auth.planBranchHint).toContain('trial');
    expect(ar.auth.planBranchHint).toContain('واتساب');
    expect(ar.auth.trialHint).toContain('التجريبية');
    expect(ar.auth.loginTitle).toBeTruthy();
    expect(ar.auth.submitLogin).not.toEqual(en.auth.submitLogin);
  });

  it('renders the XIRA hero and login form in LTR', () => {
    renderAuth(<LoginPage />);
    expect(screen.getByText('XIRA')).toBeInTheDocument();
    expect(screen.getByText(en.auth.heroTag)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.auth.loginTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.email)).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.password)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.auth.loginCta })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Forgot password/i })).toBeDisabled();
    expect(screen.getByText('E-Invoicing')).toBeInTheDocument();
  });

  it('renders the Arabic hero in RTL copy', () => {
    renderAuth(<LoginPage />, 'ar', '/ar/login');
    expect(screen.getByText(ar.auth.heroTag)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: ar.auth.loginTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ar.auth.loginCta })).toBeInTheDocument();
  });

  it('shows field validation on empty login submit', async () => {
    renderAuth(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: en.auth.loginCta }));
    expect(await screen.findByText(en.auth.invalidEmail)).toBeInTheDocument();
    expect(screen.getByText(en.auth.passwordTooShort)).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('submits login then routes home when context is ready', async () => {
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace });
    mockLogin.mockResolvedValue({ user: { id: 'u1' } });
    renderAuth(<LoginPage />);
    fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: 'owner@test.local' } });
    fireEvent.change(screen.getByLabelText(en.auth.password), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: en.auth.loginCta }));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith({ email: 'owner@test.local', password: 'Password123' }));
    expect(establishTenantContext).toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en'));
  });

  it('keeps existing login routing order: onboarding then ETA setup then home', async () => {
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace });
    mockLogin.mockResolvedValue({ user: { id: 'u1' } });

    (establishTenantContext as jest.Mock).mockResolvedValueOnce({ needsOnboarding: true, promptEtaSetup: false });
    renderAuth(<LoginPage />);
    fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(en.auth.password), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: en.auth.loginCta }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/onboarding'));

    replace.mockClear();
    (establishTenantContext as jest.Mock).mockResolvedValueOnce({ needsOnboarding: false, promptEtaSetup: true });
    fireEvent.click(screen.getByRole('button', { name: en.auth.loginCta }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/settings/eta-credentials'));
  });

  it('shows the generic error when login fails', async () => {
    mockLogin.mockRejectedValue(new Error('nope'));
    renderAuth(<LoginPage />);
    fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(en.auth.password), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: en.auth.loginCta }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.errorGeneric);
  });

  it('marks the login submit button busy while login is in flight', async () => {
    let finish!: (value: unknown) => void;
    mockLogin.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderAuth(<LoginPage />);
    fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(en.auth.password), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: en.auth.loginCta }));
    expect(await screen.findByRole('button', { name: en.auth.loginCta })).toHaveAttribute('aria-busy', 'true');
    finish({ user: { id: 'u1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: en.auth.loginCta })).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('renders register fields and keeps the existing registration flow', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn() });
    mockRegister.mockResolvedValue({ user: { id: 'u1' } });
    renderAuth(<RegisterPage />, 'en', '/en/register');
    expect(screen.getByRole('heading', { name: en.auth.registerTitle })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.auth.submitRegister }));
    expect(await screen.findByText(en.auth.invalidEmail)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: 'new@test.local' } });
    fireEvent.change(screen.getByLabelText(en.auth.password), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: en.auth.submitRegister }));
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@test.local', password: 'Password123' }),
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/onboarding'));
  });

  it('keeps onboarding company + plan selection and createTenant', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn() });
    (createTenant as jest.Mock).mockResolvedValue({ id: 't1', name: 'Acme', activationStatus: 'ACTIVE' });
    renderAuth(<OnboardingPage />, 'en', '/en/onboarding');
    expect(await screen.findByRole('heading', { name: en.auth.onboardingTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.tenantName)).toBeInTheDocument();
    expect(screen.getByLabelText(en.auth.taxRegistrationNumber)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Trial' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: en.billing.startFreeTrial })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.fillCompanyFirst);
    fireEvent.change(screen.getByLabelText(en.auth.tenantName), { target: { value: 'Acme' } });
    fireEvent.click(screen.getAllByRole('button', { name: en.billing.startFreeTrial })[0]!);
    await waitFor(() =>
      expect(createTenant).toHaveBeenCalledWith('Acme', { planCode: 'TRIAL', taxRegistrationNumber: undefined }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/settings/eta-credentials'));
  });

  it('keeps trial-already-used and company-limit errors', async () => {
    (createTenant as jest.Mock).mockRejectedValueOnce(
      new ApiError('taken', 409, { code: 'TRIAL_ALREADY_USED', messageEn: 'trial used', messageAr: 'مستخدمة' }),
    );
    renderAuth(<OnboardingPage />, 'en', '/en/onboarding');
    fireEvent.change(await screen.findByLabelText(en.auth.tenantName), { target: { value: 'Acme' } });
    fireEvent.click(screen.getAllByRole('button', { name: en.billing.startFreeTrial })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('trial used');
  });
});
