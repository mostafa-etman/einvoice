import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import {
  dismissEtaSetupPrompt,
  getEtaCredentials,
  getEtaSetupStatus,
  rotateEtaSecret,
  upsertEtaCredentials,
  type EtaCredentialsView,
} from '@/lib/api/eta-credentials';
import { getEtaConnection, testEtaConnection } from '@/lib/api/eta';
import {
  clearSandboxData,
  getEtaEnvironment,
  goLive,
  switchEtaEnvironment,
  type EtaEnvironmentStatus,
} from '@/lib/api/eta-environment';
import EtaCredentialsPage from './page';

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

jest.mock('@/lib/api/eta-credentials', () => ({
  getEtaCredentials: jest.fn(),
  getEtaSetupStatus: jest.fn(),
  upsertEtaCredentials: jest.fn(),
  rotateEtaSecret: jest.fn(),
  dismissEtaSetupPrompt: jest.fn(),
}));

jest.mock('@/lib/api/eta', () => ({
  getEtaConnection: jest.fn(),
  testEtaConnection: jest.fn(),
  listEtaDocumentTypes: jest.fn(),
  getEtaDocumentTypeVersions: jest.fn(),
}));

jest.mock('@/lib/api/eta-environment', () => ({
  getEtaEnvironment: jest.fn(),
  switchEtaEnvironment: jest.fn(),
  clearSandboxData: jest.fn(),
  goLive: jest.fn(),
}));

function envFixture(
  overrides: Partial<EtaEnvironmentStatus> = {},
): EtaEnvironmentStatus {
  return {
    activeEnvironment: 'SANDBOX',
    label: 'sandbox',
    identityBaseUrl: 'https://id.example',
    apiBaseUrl: 'https://api.example',
    sandboxCredentialsConfigured: true,
    productionCredentialsConfigured: false,
    productionValidatedAt: null,
    canSwitchToProduction: false,
    sandboxDocumentCount: 3,
    productionDocumentCount: 0,
    productionProtectedCount: 0,
    ...overrides,
  };
}

function credsFixture(
  overrides: Partial<EtaCredentialsView> = {},
): EtaCredentialsView {
  return {
    branchId: null,
    environment: 'SANDBOX',
    clientId: 'client-id',
    hasClientSecret: true,
    clientSecretMasked: '********abcd',
    registrationNumber: '123456789',
    activityCode: '6200',
    isIntermediary: false,
    onBehalfOfRegistrationNumber: null,
    onBehalfOfName: null,
    taxpayerLegalName: 'Acme Corp',
    issuerType: 'B',
    issuerIdentityComplete: true,
    lastValidatedAt: null,
    activeEnvironment: 'SANDBOX',
    ...overrides,
  };
}

function renderPage(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={en}>
          <EtaCredentialsPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('ETA credentials behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getEtaEnvironment as jest.Mock).mockResolvedValue(envFixture());
    (getEtaCredentials as jest.Mock).mockResolvedValue(credsFixture());
    (getEtaConnection as jest.Mock).mockResolvedValue({
      connected: true,
      setupRequired: false,
      expiresAt: null,
      scope: null,
      environment: 'SANDBOX',
      lastTestOutcome: 'never',
      lastTestMessage: null,
      settingsPath: '/settings/eta-credentials',
    });
    (getEtaSetupStatus as jest.Mock).mockResolvedValue({
      etaConfigured: true,
      promptDismissed: true,
      promptEtaSetup: false,
      tutorialVideoUrl: null,
    });
    (upsertEtaCredentials as jest.Mock).mockResolvedValue(credsFixture());
    (rotateEtaSecret as jest.Mock).mockResolvedValue(credsFixture());
    (dismissEtaSetupPrompt as jest.Mock).mockResolvedValue({
      etaConfigured: true,
      promptDismissed: true,
      promptEtaSetup: false,
      tutorialVideoUrl: null,
    });
    (testEtaConnection as jest.Mock).mockResolvedValue({
      connected: true,
      setupRequired: false,
      lastTestOutcome: 'success',
    });
    (switchEtaEnvironment as jest.Mock).mockResolvedValue(envFixture());
    (clearSandboxData as jest.Mock).mockResolvedValue({
      deletedDocuments: 2,
      deletedReceivedDocuments: 0,
      deletedSubmissions: 0,
      deletedArtifacts: 0,
      skippedProductionProtected: 0,
    });
    (goLive as jest.Mock).mockResolvedValue({
      environment: envFixture({ activeEnvironment: 'PRODUCTION', label: 'production' }),
    });
  });

  it('keeps the existing environment query key and badge source', async () => {
    const { qc } = renderPage();
    const badge = await screen.findByTestId('eta-env-badge');
    expect(badge).toHaveTextContent(en.settingsEta.badgeSandbox);

    await waitFor(() => {
      const keys = qc.getQueryCache().findAll().map((q) => q.queryKey);
      expect(keys).toEqual(
        expect.arrayContaining([
          ['eta-environment', 'tenant-1'],
          ['eta-credentials', 'tenant-1', 'SANDBOX'],
          ['eta-connection', 'tenant-1'],
          ['eta-setup', 'tenant-1'],
        ]),
      );
    });
  });

  it('does not derive the environment badge from the credentials select', async () => {
    (getEtaEnvironment as jest.Mock).mockResolvedValue(
      envFixture({
        activeEnvironment: 'PRODUCTION',
        label: 'production',
        canSwitchToProduction: true,
      }),
    );
    (getEtaCredentials as jest.Mock).mockImplementation(
      ({ environment }: { environment: string }) =>
        Promise.resolve(
          credsFixture({
            environment: environment as 'SANDBOX' | 'PRODUCTION',
            activeEnvironment: 'PRODUCTION',
          }),
        ),
    );

    const { qc } = renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('eta-env-badge')).toHaveTextContent(
        en.settingsEta.badgeProduction,
      );
    });

    const select = screen.getByTestId('eta-cred-env-select');
    expect(select).toHaveValue('SANDBOX');
    fireEvent.change(select, { target: { value: 'PRODUCTION' } });
    expect(select).toHaveValue('PRODUCTION');
    expect(screen.getByTestId('eta-env-badge')).toHaveTextContent(
      en.settingsEta.badgeProduction,
    );

    await waitFor(() => {
      const keys = qc.getQueryCache().findAll().map((q) => q.queryKey);
      expect(keys).toEqual(
        expect.arrayContaining([['eta-credentials', 'tenant-1', 'PRODUCTION']]),
      );
    });
    expect(getEtaCredentials).toHaveBeenCalledWith({ environment: 'PRODUCTION' });
  });

  it('saves credentials with the selected environment and does not expose the secret', async () => {
    renderPage();
    await screen.findByDisplayValue('client-id');
    expect(screen.getByText('********abcd', { exact: false })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('client-secret-value')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en.settingsEta.save }));
    await waitFor(() => {
      expect(upsertEtaCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-id',
          clientSecret: '',
          registrationNumber: '123456789',
          taxpayerLegalName: 'Acme Corp',
          issuerType: 'B',
          environment: 'SANDBOX',
        }),
      );
    });
  });

  it('keeps Go Live disabled until the existing production gate is met', async () => {
    renderPage();
    const goLiveBtn = await screen.findByRole('button', { name: en.settingsEta.goLiveConfirm });
    expect(goLiveBtn).toBeDisabled();
    expect(screen.queryByTestId('go-live-confirm')).not.toBeInTheDocument();
    fireEvent.click(goLiveBtn);
    expect(goLive).not.toHaveBeenCalled();
  });

  it('requires typed confirmation before Go Live when clearing sandbox data', async () => {
    (getEtaEnvironment as jest.Mock).mockResolvedValue(
      envFixture({ canSwitchToProduction: true }),
    );
    renderPage();
    const goLiveBtn = await screen.findByRole('button', { name: en.settingsEta.goLiveConfirm });
    await waitFor(() => expect(goLiveBtn).toBeEnabled());

    fireEvent.click(screen.getByLabelText(en.settingsEta.goLiveClear));
    const confirm = await screen.findByTestId('go-live-confirm');
    expect(goLiveBtn).toBeDisabled();

    fireEvent.click(goLiveBtn);
    expect(goLive).not.toHaveBeenCalled();

    fireEvent.change(confirm, { target: { value: 'Acme Corp' } });
    expect(goLiveBtn).toBeEnabled();
    fireEvent.click(goLiveBtn);

    await waitFor(() => {
      expect(goLive).toHaveBeenCalledWith({
        clearSandboxData: true,
        confirmation: 'Acme Corp',
      });
    });
  });

  it('cancels Go Live confirmation by unchecking the clear option without mutating', async () => {
    (getEtaEnvironment as jest.Mock).mockResolvedValue(
      envFixture({ canSwitchToProduction: true }),
    );
    renderPage();
    const goLiveBtn = await screen.findByRole('button', { name: en.settingsEta.goLiveConfirm });
    await waitFor(() => expect(goLiveBtn).toBeEnabled());
    fireEvent.click(screen.getByLabelText(en.settingsEta.goLiveClear));
    await screen.findByTestId('go-live-confirm');
    fireEvent.click(screen.getByLabelText(en.settingsEta.goLiveClear));
    expect(screen.queryByTestId('go-live-confirm')).not.toBeInTheDocument();
    expect(goLiveBtn).toBeEnabled();
    expect(goLive).not.toHaveBeenCalled();
  });

  it('requires typed confirmation before clearing sandbox data', async () => {
    renderPage();
    const clearBtn = await screen.findByRole('button', {
      name: en.settingsEta.clearSandboxButton,
    });
    expect(clearBtn).toBeDisabled();
    const confirm = screen.getByTestId('clear-sandbox-confirm');
    fireEvent.click(clearBtn);
    expect(clearSandboxData).not.toHaveBeenCalled();

    fireEvent.change(confirm, { target: { value: 'CLEAR SANDBOX DATA' } });
    expect(clearBtn).toBeEnabled();
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(clearSandboxData).toHaveBeenCalledWith('CLEAR SANDBOX DATA');
    });
  });

  it('keeps Go Live disabled while already in production', async () => {
    (getEtaEnvironment as jest.Mock).mockResolvedValue(
      envFixture({
        activeEnvironment: 'PRODUCTION',
        label: 'production',
        canSwitchToProduction: true,
      }),
    );
    renderPage();
    const goLiveBtn = await screen.findByRole('button', { name: en.settingsEta.goLiveConfirm });
    expect(goLiveBtn).toBeDisabled();
    fireEvent.click(goLiveBtn);
    expect(goLive).not.toHaveBeenCalled();
  });
});
