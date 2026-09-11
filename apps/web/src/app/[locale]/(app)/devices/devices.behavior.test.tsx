import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ApiError } from '@/lib/api/client';
import {
  createPairingCode,
  listDevices,
  unpairDevice,
  type DeviceSummary,
} from '@/lib/api/devices';
import DevicesPage from './page';

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

jest.mock('@/lib/api/devices', () => ({
  listDevices: jest.fn(),
  createPairingCode: jest.fn(),
  unpairDevice: jest.fn(),
}));

function device(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    id: 'dev-1',
    label: 'Front desk agent',
    status: 'PAIRED',
    lastSeenAt: '2026-01-02T00:00:00.000Z',
    pairedAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    ready: null,
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
          <DevicesPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('devices page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listDevices as jest.Mock).mockResolvedValue({ items: [device()] });
    (createPairingCode as jest.Mock).mockResolvedValue({
      id: 'code-1',
      code: 'PAIR-1234',
      expiresAt: '2026-01-03T00:00:00.000Z',
    });
    (unpairDevice as jest.Mock).mockResolvedValue(undefined);
  });

  it('keeps the devices query key and renders device data', async () => {
    const { qc } = renderPage();
    expect(await screen.findByText('Front desk agent')).toBeInTheDocument();
    expect(screen.getByText('PAIRED')).toHaveAttribute('dir', 'ltr');
    await waitFor(() => {
      expect(qc.getQueryCache().findAll().map((q) => q.queryKey)).toEqual(
        expect.arrayContaining([['devices', 'tenant-1']]),
      );
    });
  });

  it('shows a loading table instead of empty', () => {
    (listDevices as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.devices.empty)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows empty state when no devices are paired', async () => {
    (listDevices as jest.Mock).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByText(en.devices.empty)).toBeInTheDocument();
  });

  it('shows a filtered empty state', async () => {
    renderPage();
    expect(await screen.findByText('Front desk agent')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en.devices.searchPlaceholder), {
      target: { value: 'zzzz-no-match' },
    });
    expect(screen.getByText(en.devices.emptyFiltered)).toBeInTheDocument();
  });

  it('shows forbidden without listing when the query is 403', async () => {
    (listDevices as jest.Mock).mockRejectedValue(new ApiError('nope', 403));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.devices.forbidden);
    expect(screen.queryByText('Front desk agent')).not.toBeInTheDocument();
  });

  it('retries a failed devices load', async () => {
    (listDevices as jest.Mock)
      .mockRejectedValueOnce(new ApiError('down', 500))
      .mockResolvedValueOnce({ items: [device()] });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.devices.retryLoad }));
    expect(await screen.findByText('Front desk agent')).toBeInTheDocument();
  });

  it('creates a pairing code with the existing mutation and shows it LTR', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.devices.createPairingCode }));
    expect(await screen.findByText('PAIR-1234')).toHaveAttribute('dir', 'ltr');
    expect(createPairingCode).toHaveBeenCalled();
  });

  it('does not unpair until confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.devices.unpair }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(unpairDevice).not.toHaveBeenCalled();
  });

  it('unpairs with the device id after confirmation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.devices.unpair }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.devices.unpair }));
    await waitFor(() => {
      expect(unpairDevice).toHaveBeenCalledWith('dev-1');
    });
  });

  it('hides unpair for revoked devices', async () => {
    (listDevices as jest.Mock).mockResolvedValue({
      items: [device({ status: 'REVOKED', revokedAt: '2026-01-04T00:00:00.000Z' })],
    });
    renderPage();
    expect(await screen.findByText('REVOKED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.devices.unpair })).not.toBeInTheDocument();
  });
});
