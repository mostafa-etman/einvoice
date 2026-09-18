import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { TenantFeedbackButton } from '@/components/feedback/tenant-feedback-button';
import { submitFeedback } from '@/lib/api/feedback';

const tenantState = { roleName: 'Owner' };

jest.mock('next/navigation', () => ({
  usePathname: () => '/en/documents',
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    roleName: tenantState.roleName,
    memberships: [],
    branches: [],
    branchId: null,
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
  }),
}));

jest.mock('@/lib/api/feedback', () => ({
  submitFeedback: jest.fn(),
}));

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={en}>
        <TenantFeedbackButton />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('tenant feedback button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantState.roleName = 'Owner';
    (submitFeedback as jest.Mock).mockResolvedValue({ id: 'fb-1', status: 'NEW' });
  });

  it('is hidden for viewers', () => {
    tenantState.roleName = 'Viewer';
    renderWidget();
    expect(screen.queryByRole('button', { name: en.feedback.button })).not.toBeInTheDocument();
  });

  it('lets a tenant admin submit notes for the current screen', async () => {
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: en.feedback.button }));
    expect(await screen.findByRole('dialog', { name: en.feedback.title })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: en.feedback.note }), {
      target: { value: 'Please add column filters' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.feedback.submit }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        screenKey: 'documents',
        routePath: '/documents',
        note: 'Please add column filters',
      }),
    );
  });
});
