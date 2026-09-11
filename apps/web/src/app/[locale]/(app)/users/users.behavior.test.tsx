import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ApiError } from '@/lib/api/client';
import { addMember, listMembers, updateMemberRole, type Member } from '@/lib/api/members';
import { listRoles, type Role } from '@/lib/api/roles';
import UsersPage from './page';

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
  addMember: jest.fn(),
  updateMemberRole: jest.fn(),
}));

jest.mock('@/lib/api/roles', () => ({
  listRoles: jest.fn(),
}));

const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const SALES_ID = '22222222-2222-2222-2222-222222222222';

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'mem-1',
    user: { id: 'u-1', email: 'ada@example.com', name: 'Ada Lovelace' },
    role: { id: OWNER_ID, name: 'Owner' },
    ...overrides,
  };
}

function roles(): Role[] {
  return [
    { id: OWNER_ID, name: 'Owner', isSystem: true, memberCount: 1, permissions: [] },
    { id: SALES_ID, name: 'Sales', isSystem: false, memberCount: 0, permissions: [] },
  ];
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
          <UsersPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('users page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listMembers as jest.Mock).mockResolvedValue([member()]);
    (listRoles as jest.Mock).mockResolvedValue(roles());
    (addMember as jest.Mock).mockResolvedValue(member());
    (updateMemberRole as jest.Mock).mockResolvedValue(member({ role: { id: SALES_ID, name: 'Sales' } }));
  });

  it('keeps the members query key and renders member data', async () => {
    const { qc } = renderPage();
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(0);
    await waitFor(() => {
      const keys = qc.getQueryCache().findAll().map((q) => q.queryKey);
      expect(keys).toEqual(
        expect.arrayContaining([
          ['members', 'tenant-1'],
          ['roles', 'tenant-1'],
        ]),
      );
    });
  });

  it('shows an empty state when there are no members', async () => {
    (listMembers as jest.Mock).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(en.users.empty)).toBeInTheDocument();
  });

  it('shows a loading table instead of an empty state', () => {
    (listMembers as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(en.users.empty)).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows a filtered empty state when search matches nobody', async () => {
    renderPage();
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en.users.searchPlaceholder), {
      target: { value: 'zzzz-no-match' },
    });
    expect(screen.getByText(en.users.emptyFiltered)).toBeInTheDocument();
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
  });

  it('shows forbidden without listing when the members query is 403', async () => {
    (listMembers as jest.Mock).mockRejectedValue(new ApiError('nope', 403));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(en.users.forbidden);
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
  });

  it('retries a failed members load', async () => {
    (listMembers as jest.Mock)
      .mockRejectedValueOnce(new ApiError('down', 500))
      .mockResolvedValueOnce([member()]);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    fireEvent.click(screen.getByRole('button', { name: en.users.retryLoad }));
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
  });

  it('opens the invite modal and cancels without mutating', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.users.invite }));
    expect(screen.getByRole('dialog')).toHaveTextContent(en.users.inviteTitle);
    fireEvent.click(screen.getByRole('button', { name: en.common.actions.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(addMember).not.toHaveBeenCalled();
  });

  it('validates invite fields before calling the API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.users.invite }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.users.invite }));
    expect(await screen.findByText(en.users.invalidEmail)).toBeInTheDocument();
    expect(screen.getByText(en.users.selectRole)).toBeInTheDocument();
    expect(addMember).not.toHaveBeenCalled();
  });

  it('closes the invite modal after a successful add', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.users.invite }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.users.email), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.users.role), { target: { value: SALES_ID } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.users.invite }));
    await waitFor(() => {
      expect(addMember).toHaveBeenCalledWith('new@example.com', SALES_ID);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('submits the existing invite payload', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.users.invite }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.users.email), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.users.role), { target: { value: SALES_ID } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.users.invite }));
    await waitFor(() => {
      expect(addMember).toHaveBeenCalledWith('new@example.com', SALES_ID);
    });
  });

  it('shows the user-limit error from a 409 invite', async () => {
    (addMember as jest.Mock).mockRejectedValue(new ApiError('limit', 409));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.users.invite }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.users.email), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.users.role), { target: { value: SALES_ID } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.users.invite }));
    expect(await screen.findByText(en.users.limitReached)).toBeInTheDocument();
  });

  it('shows forbidden when invite is 403', async () => {
    (addMember as jest.Mock).mockRejectedValue(new ApiError('no', 403));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.users.invite }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.users.email), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.users.role), { target: { value: SALES_ID } });
    fireEvent.click(within(dialog).getByRole('button', { name: en.users.invite }));
    expect(await within(dialog).findByText(en.users.forbidden)).toBeInTheDocument();
  });

  it('changes a member role with the existing payload', async () => {
    renderPage();
    const roleSelect = await screen.findByLabelText(en.users.role);
    fireEvent.change(roleSelect, { target: { value: SALES_ID } });
    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith('mem-1', SALES_ID);
    });
  });

  it('does not mutate when the selected role is unchanged', async () => {
    renderPage();
    const roleSelect = await screen.findByLabelText(en.users.role);
    fireEvent.change(roleSelect, { target: { value: OWNER_ID } });
    await waitFor(() => expect(listMembers).toHaveBeenCalled());
    expect(updateMemberRole).not.toHaveBeenCalled();
  });
});
