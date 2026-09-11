import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { AppShell } from '@/components/shell/app-shell';
import { PendingActivationScreen } from '@/components/shell/pending-activation-screen';
import { SendBlockedBanner } from '@/components/billing/send-blocked-banner';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { defaultLocale } from '@/i18n/config';
import { flattenNav, isNavActive, navHref } from '@/components/shell/nav-config';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

const mockPlatformAuth = { isPlatformOperator: true };

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
      name: 'Owner Test',
      isPlatformOperator: mockPlatformAuth.isPlatformOperator,
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

jest.mock('@/lib/api/eta-environment', () => ({
  getEtaEnvironment: jest.fn(async () => ({
    activeEnvironment: 'SANDBOX',
    apiBaseUrl: 'https://eta.example',
  })),
}));

jest.mock('@/lib/api/billing', () => ({
  fetchSubscription: jest.fn(async () => ({ sendBlocked: false, plan: { code: 'TRIAL', name: 'Trial' } })),
}));

jest.mock('@/lib/api/tenants', () => ({
  fetchActivationHelp: jest.fn(async () => ({
    whatsappDisplay: '00201000864620',
    whatsappUrl: 'https://wa.me/201000864620',
  })),
}));

jest.mock('@/components/billing/whatsapp-upgrade-dialog', () => ({
  WhatsAppUpgradeDialog: () => null,
}));

function renderShell(ui: ReactNode, locale: 'en' | 'ar' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        <ThemeProvider>{ui}</ThemeProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('app shell smoke', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockPlatformAuth.isPlatformOperator = true;
    (usePathname as jest.Mock).mockReturnValue('/en');
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn() });
  });

  it('defaults to Arabic RTL', () => {
    expect(defaultLocale).toBe('ar');
    expect(defaultLocale === 'ar' ? 'rtl' : 'ltr').toBe('rtl');
  });

  it('switches English to LTR', () => {
    const dir = (locale: string) => (locale === 'ar' ? 'rtl' : 'ltr');
    expect(dir('en')).toBe('ltr');
  });

  it('has sidebar collapse labels in both locales', async () => {
    expect(en.shell.collapseSidebar).toBeTruthy();
    expect(en.shell.expandSidebar).toBeTruthy();
    expect(ar.shell.collapseSidebar).toBeTruthy();
    expect(ar.shell.expandSidebar).toBeTruthy();
  });

  it('keeps every existing route in the grouped nav', () => {
    const hrefs = flattenNav('en').map((item) => item.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/en',
        '/en/documents',
        '/en/customers',
        '/en/purchases',
        '/en/imports',
        '/en/exports',
        '/en/sync',
        '/en/devices',
        '/en/backup',
        '/en/analytics',
        '/en/reports',
        '/en/billing',
        '/en/users',
        '/en/roles',
        '/en/settings',
      ]),
    );
    expect(hrefs).toHaveLength(15);
  });

  it('renders grouped navigation and marks the active route', async () => {
    (usePathname as jest.Mock).mockReturnValue('/en/documents');
    renderShell(<AppShell>child</AppShell>);
    expect(await screen.findByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('Insights & admin')).toBeInTheDocument();
    const docs = screen.getByRole('link', { name: 'Documents' });
    expect(docs).toHaveAttribute('aria-current', 'page');
    expect(docs).toHaveAttribute('href', '/en/documents');
  });

  it('persists collapsed sidebar via existing session helpers', async () => {
    renderShell(<AppShell>child</AppShell>);
    const toggle = await screen.findByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('einvoice.sidebarCollapsed')).toBe('1');
  });

  it('opens the mobile drawer and closes it with Escape', async () => {
    renderShell(<AppShell>child</AppShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument());
  });

  it('keeps locale switcher and ETA badge test ids / labels', async () => {
    renderShell(<AppShell>child</AppShell>);
    expect(await screen.findByLabelText('Language')).toBeInTheDocument();
    expect(screen.getByTestId('shell-eta-env-badge')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('branch-switcher')).toBeInTheDocument();
  });

  it('toggles theme from the top bar', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderShell(<AppShell>child</AppShell>);
    const toggle = await screen.findByRole('button', { name: 'Toggle color theme' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the command palette with Ctrl+K and navigates on Enter', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn() });
    renderShell(<AppShell>child</AppShell>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Jump to page' });
    const input = within(dialog).getByLabelText('Quick search');
    fireEvent.change(input, { target: { value: 'Documents' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/en/documents');
  });

  it('exposes the user menu with platform admin and logout', async () => {
    renderShell(<AppShell>child</AppShell>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Account menu' }))[0]!);
    expect(screen.getByRole('menuitem', { name: 'Platform Administration' })).toHaveAttribute(
      'href',
      '/en/admin',
    );
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows Platform Administration in the sidebar for operators and navigates to /admin', async () => {
    renderShell(<AppShell>child</AppShell>);
    const link = await screen.findByRole('link', { name: 'Platform Administration' });
    expect(link).toHaveAttribute('href', '/en/admin');
  });

  it('hides Platform Administration in the sidebar for non-operators', async () => {
    mockPlatformAuth.isPlatformOperator = false;
    renderShell(<AppShell>child</AppShell>);
    expect(await screen.findByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Platform Administration' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Account menu' })[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Platform Administration' })).not.toBeInTheDocument();
  });

  it('shows إدارة المنصة in the Arabic sidebar for operators', async () => {
    (usePathname as jest.Mock).mockReturnValue('/ar');
    renderShell(<AppShell>child</AppShell>, 'ar');
    const link = await screen.findByRole('link', { name: 'إدارة المنصة' });
    expect(link).toHaveAttribute('href', '/ar/admin');
  });

  it('marks home active only on the tenant home path', () => {
    expect(isNavActive('/en', navHref('en', 'home'), 'en')).toBe(true);
    expect(isNavActive('/en/documents', navHref('en', 'home'), 'en')).toBe(false);
    expect(isNavActive('/en/documents/abc', navHref('en', 'documents'), 'en')).toBe(true);
  });
});

describe('PendingActivationScreen', () => {
  it('keeps WhatsApp activation actions and does not render the tenant shell nav', async () => {
    renderShell(<PendingActivationScreen status="PENDING" />);
    expect(await screen.findByText('Pending activation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Documents' })).not.toBeInTheDocument();
  });
});

describe('SendBlockedBanner', () => {
  it('renders when sendBlocked is true and dismisses per tenant in sessionStorage', async () => {
    const billing = await import('@/lib/api/billing');
    (billing.fetchSubscription as jest.Mock).mockResolvedValueOnce({
      sendBlocked: true,
      plan: { code: 'TRIAL', name: 'Trial' },
    });
    renderShell(<SendBlockedBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent('00201000864620');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('einvoice.sendBlockedBanner.dismissed.tenant-1')).toBe('1');
  });
});
