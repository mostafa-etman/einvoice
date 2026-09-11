'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { addMember, listMembers, updateMemberRole, type Member } from '@/lib/api/members';
import { listRoles } from '@/lib/api/roles';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FilterBar } from '@/components/ui/filter-bar';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

const schema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
});

type FormValues = z.infer<typeof schema>;

function initials(member: Member) {
  const source = member.user.name?.trim() || member.user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '');
  return letters.toUpperCase();
}

export default function UsersPage() {
  const t = useTranslations('users');
  const tNav = useTranslations('nav');
  const tActions = useTranslations('common.actions');
  const tUi = useTranslations('ui');
  const locale = useLocale();
  const toast = useMutationToast();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');

  const membersQuery = useQuery({
    queryKey: ['members', tenantId],
    queryFn: listMembers,
    enabled: !!tenantId,
  });
  const rolesQuery = useQuery({
    queryKey: ['roles', tenantId],
    queryFn: listRoles,
    enabled: !!tenantId,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const invite = useMutation({
    mutationFn: (values: FormValues) => addMember(values.email, values.roleId),
    onSuccess: async () => {
      reset();
      setInviteOpen(false);
      await qc.invalidateQueries({ queryKey: ['members', tenantId] });
      toast.created();
    },
    onError: (err) => {
      toast.error(err);
    },
  });

  const changeRole = useMutation({
    mutationFn: (input: { membershipId: string; roleId: string }) =>
      updateMemberRole(input.membershipId, input.roleId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['members', tenantId] });
      toast.saved();
    },
    onError: (err) => {
      toast.error(err);
    },
  });

  const forbidden =
    membersQuery.error instanceof ApiError && membersQuery.error.status === 403;

  const members = membersQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = m.user.name?.toLowerCase() ?? '';
      return m.user.email.toLowerCase().includes(q) || name.includes(q);
    });
  }, [members, search]);

  const columns: TableColumn<Member>[] = [
    {
      id: 'member',
      header: t('member'),
      cell: (m) => (
        <div className="flex items-center gap-token-sm">
          <span
            aria-hidden
            className="inline-flex size-avatar shrink-0 items-center justify-center rounded-pill bg-gradient-brand-soft text-token-xs font-semibold text-brand"
          >
            {initials(m)}
          </span>
          <span className="min-w-0">
            {m.user.name ? (
              <span className="block font-medium text-foreground">{m.user.name}</span>
            ) : null}
            <span className="block font-en text-token-xs text-foreground-muted" dir="ltr">
              {m.user.email}
            </span>
          </span>
        </div>
      ),
    },
    {
      id: 'role',
      header: t('role'),
      cell: (m) => (
        <div className="flex min-w-[12rem] flex-wrap items-center gap-token-sm">
          <Badge variant="neutral">{m.role.name}</Badge>
          <Select
            className="max-w-[16rem]"
            aria-label={t('role')}
            value={m.role.id}
            disabled={changeRole.isPending}
            onChange={(e) => {
              const roleId = e.target.value;
              if (roleId === m.role.id) return;
              changeRole.mutate({ membershipId: m.id, roleId });
            }}
          >
            {(rolesQuery.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
      ),
    },
  ];

  function closeInvite() {
    setInviteOpen(false);
    reset();
  }

  return (
    <div className="space-y-token-lg">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tNav('home'), href: `/${locale}` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        subtitle={t('inviteHint')}
        actions={
          <>
            <Link
              href={`/${locale}/roles`}
              className="inline-flex items-center justify-center rounded-button border border-border-strong bg-surface px-button-x py-button-y text-button font-medium text-foreground shadow-xs hover:border-brand hover:bg-surface-alt hover:text-brand focus-visible:outline-none focus-visible:shadow-ring"
            >
              {t('manageRoles')}
            </Link>
            <Button type="button" onClick={() => setInviteOpen(true)}>
              {t('invite')}
            </Button>
          </>
        }
      />

      {forbidden ? (
        <p className="text-token-sm text-danger" role="alert">
          {t('forbidden')}
        </p>
      ) : null}
      {membersQuery.isError && !forbidden ? (
        <Card className="border-danger" role="alert">
          <p className="text-token-sm text-danger">
            {membersQuery.error instanceof Error
              ? membersQuery.error.message
              : t('errorGeneric')}
          </p>
          <Button
            className="mt-token-sm"
            variant="secondary"
            size="sm"
            onClick={() => void membersQuery.refetch()}
          >
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}
      {changeRole.error instanceof ApiError ? (
        <p className="text-token-sm text-danger" role="alert">
          {changeRole.error.status === 403 ? t('forbidden') : changeRole.error.message}
        </p>
      ) : null}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('searchPlaceholder')}
        onReset={search ? () => setSearch('') : undefined}
      />

      <div aria-busy={membersQuery.isLoading || undefined}>
        <Table
          caption={t('listCaption')}
          columns={columns}
          rows={filtered}
          getRowId={(m) => m.id}
          loading={membersQuery.isLoading}
          empty={
            <EmptyState
              title={search.trim() ? t('emptyFiltered') : t('empty')}
              action={
                forbidden
                  ? undefined
                  : search.trim()
                    ? { label: tUi('filterReset'), onClick: () => setSearch('') }
                    : { label: t('invite'), onClick: () => setInviteOpen(true) }
              }
            />
          }
        />
      </div>

      <Modal
        open={inviteOpen}
        onClose={closeInvite}
        title={t('inviteTitle')}
        description={t('inviteHint')}
      >
        <form
          className="space-y-token-md"
          onSubmit={handleSubmit((values) => invite.mutate(values))}
        >
          <Input
            type="email"
            label={t('email')}
            error={errors.email ? t('invalidEmail') : undefined}
            dir="ltr"
            {...register('email')}
          />
          <Select label={t('role')} error={errors.roleId ? t('selectRole') : undefined} {...register('roleId')}>
            <option value="">—</option>
            {(rolesQuery.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          {invite.error instanceof ApiError && invite.error.status === 409 ? (
            <p className="text-token-sm text-danger" role="alert">
              {t('limitReached')}
            </p>
          ) : null}
          {invite.error instanceof ApiError && invite.error.status === 403 ? (
            <p className="text-token-sm text-danger" role="alert">
              {t('forbidden')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-token-sm">
            <Button type="button" variant="secondary" onClick={closeInvite}>
              {tActions('cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || invite.isPending}>
              {t('invite')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
