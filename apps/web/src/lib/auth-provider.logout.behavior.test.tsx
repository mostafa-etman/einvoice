import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { AuthProvider, useAuth } from './auth-provider';
import { LogoutUnsyncedDialog } from '@/components/auth/logout-unsynced-dialog';
import * as authApi from '@/lib/api/auth';
import { countUnsynced } from '@/lib/offline/draft-queue';

jest.mock('@/lib/api/auth', () => ({
  login: jest.fn(),
  register: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/offline/draft-queue', () => ({
  countUnsynced: jest.fn(),
}));

jest.mock('@/lib/session', () => {
  const actual = jest.requireActual('@/lib/session');
  return {
    ...actual,
    getActiveTenantId: jest.fn(() => 'tenant-1'),
    getSessionHint: jest.fn(() => false),
  };
});

function LogoutButton() {
  const { logout, ready } = useAuth();
  return (
    <button type="button" disabled={!ready} onClick={() => void logout()}>
      Trigger logout
    </button>
  );
}

function renderLogout() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AuthProvider>
        <LogoutUnsyncedDialog />
        <LogoutButton />
      </AuthProvider>
    </NextIntlClientProvider>,
  );
}

describe('logout unsynced confirm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authApi.logout as jest.Mock).mockResolvedValue(undefined);
  });

  it('does not use window.confirm and can cancel logout when drafts are unsynced', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm');
    (countUnsynced as jest.Mock).mockResolvedValue(2);
    renderLogout();
    fireEvent.click(await screen.findByRole('button', { name: 'Trigger logout' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(en.auth.logoutUnsyncedTitle);
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(authApi.logout).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('signs out after confirming unsynced drafts', async () => {
    (countUnsynced as jest.Mock).mockResolvedValue(2);
    renderLogout();
    fireEvent.click(await screen.findByRole('button', { name: 'Trigger logout' }));
    fireEvent.click(await screen.findByRole('button', { name: en.nav.logout }));
    await waitFor(() => {
      expect(authApi.logout).toHaveBeenCalledTimes(1);
    });
  });

  it('signs out immediately when there are no unsynced drafts', async () => {
    (countUnsynced as jest.Mock).mockResolvedValue(0);
    renderLogout();
    fireEvent.click(await screen.findByRole('button', { name: 'Trigger logout' }));
    await waitFor(() => {
      expect(authApi.logout).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
