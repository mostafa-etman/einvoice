import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { WhatsAppUpgradeDialog } from './whatsapp-upgrade-dialog';

jest.mock('@/lib/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'owner@test.local', name: 'Owner' } }),
}));

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    memberships: [{ tenant: { id: 'tenant-1', name: 'Acme' } }],
  }),
}));

jest.mock('@/lib/api/tenants', () => ({
  fetchActivationHelp: jest.fn(async () => ({
    whatsappDisplay: '00201000864620',
    whatsappUrl: 'https://wa.me/201000864620',
  })),
}));

function renderDialog(onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={en}>
          <WhatsAppUpgradeDialog
            open
            interest={{ kind: 'upgrade', planCode: 'STARTER', planLabel: 'Starter' }}
            currentPlanLabel="Trial"
            onClose={onClose}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('WhatsAppUpgradeDialog', () => {
  it('keeps the phone number LTR without flipping the whole CTA and closes on Escape', () => {
    const { onClose } = renderDialog();
    expect(screen.getByRole('dialog', { name: en.billing.whatsappUpgradeTitle })).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: new RegExp(en.billing.whatsappCta) });
    expect(cta).not.toHaveAttribute('dir', 'ltr');
    expect(within(cta).getByText('00201000864620')).toHaveAttribute('dir', 'ltr');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
