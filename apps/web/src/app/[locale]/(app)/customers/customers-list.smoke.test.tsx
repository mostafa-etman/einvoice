import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import { ApiError } from '@/lib/api/client';
import {
  createCustomer,
  deactivateCustomer,
  listCustomers,
  updateCustomer,
  type Customer,
} from '@/lib/api/customers';
import { listEtaCodes } from '@/lib/api/eta-codes';
import CustomersPage from './page';
import { PAGE_SIZE, emptyForm } from './_components/customer-list-utils';

jest.mock('@/lib/tenant-provider', () => ({
  useTenant: () => ({
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    memberships: [],
    branches: [{ id: 'branch-1', name: 'Main' }],
    setTenantId: jest.fn(),
    setBranchId: jest.fn(),
    roleName: 'Owner',
  }),
}));

jest.mock('@/lib/api/customers', () => ({
  listCustomers: jest.fn(),
  createCustomer: jest.fn(),
  updateCustomer: jest.fn(),
  deactivateCustomer: jest.fn(),
}));

jest.mock('@/lib/api/eta-codes', () => ({
  listEtaCodes: jest.fn(),
}));

function customerRow(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cus-1',
    type: 'B',
    registrationId: '123456789',
    name: 'Acme Co',
    nameEn: 'Acme Co EN',
    address: {
      country: 'EG',
      governate: 'Cairo',
      regionCity: '',
      street: '',
      buildingNumber: '',
    },
    code: 'ACM',
    email: 'a@example.com',
    phone: '01000000000',
    isActive: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    receiver: {
      type: 'B',
      id: '123456789',
      name: 'Acme Co',
      address: { country: 'EG' },
    },
    ...overrides,
  };
}

function renderPage(locale: 'en' | 'ar' = 'en', client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
          <CustomersPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('customers list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listEtaCodes as jest.Mock).mockResolvedValue({
      entries: [{ code: 'EG', nameEn: 'Egypt', nameAr: 'مصر', parentCode: null, meta: null }],
    });
  });

  it('keeps the existing page size', () => {
    expect(PAGE_SIZE).toBe(25);
  });

  it('starts create with the existing CustomerWrite defaults', () => {
    expect(emptyForm()).toEqual({
      type: 'B',
      registrationId: '',
      name: '',
      nameEn: '',
      address: {
        country: 'EG',
        governate: '',
        regionCity: '',
        street: '',
        buildingNumber: '',
      },
      code: '',
      email: '',
      phone: '',
      isActive: true,
    });
  });

  it('shows a loading skeleton until the first fetch settles', async () => {
    let resolveList!: (value: { items: Customer[]; nextCursor: string | null }) => void;
    (listCustomers as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    renderPage();
    expect(screen.getByTestId('customers-loading')).toBeInTheDocument();
    await act(async () => {
      resolveList({ items: [], nextCursor: null });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('customers-loading')).not.toBeInTheDocument();
    });
  });

  it('renders an empty state when there are no customers', async () => {
    (listCustomers as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByTestId('customers-empty')).toBeInTheDocument();
    expect(screen.getByText(en.customers.empty)).toBeInTheDocument();
  });

  it('renders an error with retry when the list fails', async () => {
    (listCustomers as jest.Mock).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByTestId('customers-error')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: en.customers.retryLoad }));
    await waitFor(() => {
      expect(listCustomers.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('shows the existing forbidden copy on 403', async () => {
    (listCustomers as jest.Mock).mockRejectedValue(new ApiError('nope', 403));
    renderPage();
    expect(await screen.findByTestId('customers-forbidden')).toHaveTextContent(
      en.customers.forbidden,
    );
    expect(screen.queryByTestId('customers-error')).not.toBeInTheDocument();
  });

  it('renders rows, status badges, and the existing list payload', async () => {
    (listCustomers as jest.Mock).mockResolvedValue({
      items: [customerRow()],
      nextCursor: null,
    });
    const { qc } = renderPage();
    expect(await screen.findByTestId('customers-table')).toBeInTheDocument();
    expect(screen.getByText('Acme Co')).toBeInTheDocument();
    expect(screen.getByText('123456789')).toHaveAttribute('dir', 'ltr');
    await waitFor(() => {
      expect(listCustomers).toHaveBeenCalledWith({
        q: undefined,
        type: undefined,
        active: true,
        sortBy: 'name',
        sortDir: 'asc',
        cursor: undefined,
        limit: 25,
      });
    });
    const keys = qc.getQueryCache().getAll().map((query) => query.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['customers', 'tenant-1', '', '', 'true', 'name', 'asc', undefined],
        ['eta-codes', 'COUNTRY'],
      ]),
    );
    expect(listEtaCodes).toHaveBeenCalledWith('COUNTRY', { limit: 300 });
  });

  it('sends the existing search and type filters to the API', async () => {
    (listCustomers as jest.Mock).mockResolvedValue({
      items: [customerRow()],
      nextCursor: null,
    });
    renderPage();
    await screen.findByTestId('customers-table');
    fireEvent.change(screen.getByRole('textbox', { name: en.customers.searchPlaceholder }), {
      target: { value: 'Acme' },
    });
    await waitFor(() => {
      expect(listCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Acme', active: true, limit: 25 }),
      );
    });
    fireEvent.change(screen.getByRole('combobox', { name: en.customers.type }), {
      target: { value: 'P' },
    });
    await waitFor(() => {
      expect(listCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Acme', type: 'P', active: true }),
      );
    });
  });

  it('loads more with the existing cursor', async () => {
    (listCustomers as jest.Mock)
      .mockResolvedValueOnce({ items: [customerRow()], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({
        items: [customerRow({ id: 'cus-2', name: 'Beta Co', registrationId: '987654321' })],
        nextCursor: null,
      });
    renderPage();
    await screen.findByText('Acme Co');
    fireEvent.click(screen.getByRole('button', { name: en.customers.loadMore }));
    expect(await screen.findByText('Beta Co')).toBeInTheDocument();
    expect(listCustomers).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2', limit: 25 }),
    );
  });

  it('deactivates with the existing customer id and no extra confirm', async () => {
    (listCustomers as jest.Mock).mockResolvedValue({
      items: [customerRow()],
      nextCursor: null,
    });
    (deactivateCustomer as jest.Mock).mockResolvedValue(customerRow({ isActive: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.customers.deactivate }));
    await waitFor(() => {
      expect(deactivateCustomer).toHaveBeenCalledWith('cus-1');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders Arabic chrome without flipping the LTR tax id', async () => {
    (listCustomers as jest.Mock).mockResolvedValue({
      items: [customerRow()],
      nextCursor: null,
    });
    renderPage('ar');
    expect(await screen.findByRole('heading', { name: ar.customers.title })).toBeInTheDocument();
    expect(await screen.findByText('123456789')).toHaveAttribute('dir', 'ltr');
  });
});

describe('customers create/edit drawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listEtaCodes as jest.Mock).mockResolvedValue({
      entries: [{ code: 'EG', nameEn: 'Egypt', nameAr: 'مصر', parentCode: null, meta: null }],
    });
    (listCustomers as jest.Mock).mockResolvedValue({ items: [customerRow()], nextCursor: null });
  });

  it('opens create in a drawer and posts the existing CustomerWrite payload', async () => {
    (createCustomer as jest.Mock).mockResolvedValue(customerRow());
    renderPage();
    await screen.findByTestId('customers-table');
    fireEvent.click(screen.getByRole('button', { name: en.customers.create }));
    const dialog = await screen.findByRole('dialog', { name: en.customers.createTitle });
    fireEvent.change(within(dialog).getByLabelText(en.customers.name), {
      target: { value: 'New Co' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.customers.registrationId), {
      target: { value: '111222333' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.customers.save }));
    await waitFor(() => {
      expect(createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'B',
          name: 'New Co',
          registrationId: '111222333',
          isActive: true,
          address: expect.objectContaining({ country: 'EG' }),
        }),
      );
    });
  });

  it('opens edit in a drawer and patches the existing customer id', async () => {
    (updateCustomer as jest.Mock).mockResolvedValue(customerRow({ name: 'Acme Updated' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.customers.edit }));
    const dialog = await screen.findByRole('dialog', { name: en.customers.editTitle });
    expect(within(dialog).getByLabelText(en.customers.name)).toHaveValue('Acme Co');
    fireEvent.change(within(dialog).getByLabelText(en.customers.name), {
      target: { value: 'Acme Updated' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.customers.save }));
    await waitFor(() => {
      expect(updateCustomer).toHaveBeenCalledWith(
        'cus-1',
        expect.objectContaining({ name: 'Acme Updated', registrationId: '123456789' }),
      );
    });
  });

  it('keeps the drawer open and shows the server error on failed create', async () => {
    (createCustomer as jest.Mock).mockRejectedValue(new ApiError('duplicate id', 422));
    (listCustomers as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: en.customers.create }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: en.customers.createTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.customers.save }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('duplicate id');
    expect(screen.getByRole('dialog', { name: en.customers.createTitle })).toBeInTheDocument();
  });

  it('cancels without calling create', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.customers.create }));
    const dialog = await screen.findByRole('dialog', { name: en.customers.createTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.customers.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(createCustomer).not.toHaveBeenCalled();
  });
});
