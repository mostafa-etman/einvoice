import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ApiError } from '@/lib/api/client';
import { listMembers, updateMemberRole, type Member } from '@/lib/api/members';
import {
  createRole,
  deleteRole,
  getPermissionCatalog,
  listRoles,
  updateRole,
  type PermissionCatalog,
  type Role,
} from '@/lib/api/roles';
import RolesPage from './page';

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

jest.mock('@/lib/api/members', () => ({
  listMembers: jest.fn(),
  updateMemberRole: jest.fn(),
  addMember: jest.fn(),
}));

jest.mock('@/lib/api/roles', () => ({
  listRoles: jest.fn(),
  getPermissionCatalog: jest.fn(),
  createRole: jest.fn(),
  updateRole: jest.fn(),
  deleteRole: jest.fn(),
}));

const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const SALES_ID = '22222222-2222-2222-2222-222222222222';
const CLERK_ID = '33333333-3333-3333-3333-333333333333';

function owner(overrides: Partial<Role> = {}): Role {
  return {
    id: OWNER_ID,
    name: 'Owner',
    isSystem: true,
    memberCount: 1,
    permissions: ['customers.view', 'customers.manage'],
    ...overrides,
  };
}

function sales(overrides: Partial<Role> = {}): Role {
  return {
    id: SALES_ID,
    name: 'Sales',
    isSystem: false,
    memberCount: 0,
    permissions: ['customers.view'],
    ...overrides,
  };
}

function catalog(overrides: Partial<PermissionCatalog> = {}): PermissionCatalog {
  return {
    canManage: true,
    codes: ['customers.view', 'customers.manage'],
    groups: [{ id: 'customers', codes: ['customers.view', 'customers.manage'] }],
    ...overrides,
  };
}

function memberRow(overrides: Partial<Member> = {}): Member {
  return {
    id: 'mem-1',
    user: { id: 'u-1', email: 'ada@example.com', name: 'Ada' },
    role: { id: OWNER_ID, name: 'Owner' },
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
          <RolesPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('roles page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listRoles as jest.Mock).mockResolvedValue([owner(), sales()]);
    (getPermissionCatalog as jest.Mock).mockResolvedValue(catalog());
    (listMembers as jest.Mock).mockResolvedValue([memberRow()]);
    (createRole as jest.Mock).mockResolvedValue(sales({ id: CLERK_ID, name: 'Clerk' }));
    (updateRole as jest.Mock).mockResolvedValue(sales());
    (deleteRole as jest.Mock).mockResolvedValue(undefined);
    (updateMemberRole as jest.Mock).mockResolvedValue(memberRow());
  });

  it('keeps roles query keys and renders role cards with permission codes', async () => {
    const { qc } = renderPage();
    expect(await screen.findByRole('button', { name: /Owner/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sales/ })).toBeInTheDocument();
    expect(await screen.findByText('customers.view')).toBeInTheDocument();
    expect(screen.getByText('customers.manage')).toBeInTheDocument();
    expect(en.roles.perm['customers.view']).toBeTruthy();
    await waitFor(() => {
      const keys = qc.getQueryCache().findAll().map((q) => q.queryKey);
      expect(keys).toEqual(
        expect.arrayContaining([
          ['roles', 'tenant-1'],
          ['permission-catalog', 'tenant-1'],
          ['members', 'tenant-1'],
        ]),
      );
    });
  });

  it('saves the selected role with the existing permission payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sales/ }));
    const manage = await screen.findByRole('checkbox', { name: /customers\.manage/ });
    fireEvent.click(manage);
    fireEvent.click(screen.getByRole('button', { name: en.roles.save }));
    await waitFor(() => {
      expect(updateRole).toHaveBeenCalledWith(SALES_ID, {
        permissions: expect.arrayContaining(['customers.view', 'customers.manage']),
      });
    });
  });

  it('creates a role with empty permissions', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.roles.create }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Role name/), { target: { value: 'Clerk' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.roles.create }));
    await waitFor(() => {
      expect(createRole).toHaveBeenCalledWith({ name: 'Clerk', permissions: [] });
    });
  });

  it('cancels create without mutating', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.roles.create }));
    fireEvent.click(screen.getByRole('button', { name: en.roles.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createRole).not.toHaveBeenCalled();
  });

  it('deletes a custom role with no members immediately', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sales/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.roles.delete }));
    await waitFor(() => {
      expect(deleteRole).toHaveBeenCalledWith(SALES_ID, undefined);
    });
  });

  it('requires reassignment before deleting a role that still has members', async () => {
    (listRoles as jest.Mock).mockResolvedValue([
      owner(),
      sales({ memberCount: 2 }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sales/ }));
    const del = await screen.findByRole('button', { name: en.roles.delete });
    expect(del).toBeDisabled();
    fireEvent.change(screen.getByLabelText(en.roles.reassignTo), { target: { value: OWNER_ID } });
    expect(del).toBeEnabled();
    fireEvent.click(del);
    await waitFor(() => {
      expect(deleteRole).toHaveBeenCalledWith(SALES_ID, OWNER_ID);
    });
  });

  it('keeps the Owner matrix disabled', async () => {
    renderPage();
    const view = await screen.findByRole('checkbox', { name: /customers\.view/ });
    expect(view).toBeDisabled();
    expect(screen.queryByRole('button', { name: en.roles.save })).not.toBeInTheDocument();
  });

  it('hides create and keeps the matrix read-only when canManage is false', async () => {
    (getPermissionCatalog as jest.Mock).mockResolvedValue(catalog({ canManage: false }));
    renderPage();
    expect(await screen.findByText(en.roles.forbiddenManage)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.roles.create })).not.toBeInTheDocument();
    const view = screen.getByRole('checkbox', { name: /customers\.view/ });
    expect(view).toBeDisabled();
  });

  it('shows forbidden when listing roles is 403', async () => {
    (listRoles as jest.Mock).mockRejectedValue(new ApiError('no', 403));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.roles.forbidden);
  });

  it('shows loading skeletons instead of an empty grid', () => {
    (listRoles as jest.Mock).mockImplementation(() => new Promise(() => {}));
    (getPermissionCatalog as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.roles.empty)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an empty state when there are no roles', async () => {
    (listRoles as jest.Mock).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(en.roles.empty)).toBeInTheDocument();
  });

  it('retries a failed roles load', async () => {
    (listRoles as jest.Mock)
      .mockRejectedValueOnce(new ApiError('down', 500))
      .mockResolvedValueOnce([owner(), sales()]);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.roles.retryLoad }));
    expect(await screen.findByRole('button', { name: /Owner/ })).toBeInTheDocument();
  });

  it('assigns an existing member with the current role id', async () => {
    (listMembers as jest.Mock).mockResolvedValue([
      memberRow(),
      memberRow({
        id: 'mem-2',
        user: { id: 'u-2', email: 'bob@example.com', name: 'Bob' },
        role: { id: SALES_ID, name: 'Sales' },
      }),
    ]);
    renderPage();
    fireEvent.change(await screen.findByLabelText(en.roles.assignMember), {
      target: { value: 'mem-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.roles.assign }));
    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith('mem-2', OWNER_ID);
    });
  });
});
