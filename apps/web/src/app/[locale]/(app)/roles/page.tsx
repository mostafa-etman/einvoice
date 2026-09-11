'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRole,
  deleteRole,
  getPermissionCatalog,
  listRoles,
  updateRole,
} from '@/lib/api/roles';
import { listMembers, updateMemberRole, type Member } from '@/lib/api/members';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { getPermissionLabels } from '@/i18n/permission-labels';
import { PermissionMatrix } from './_components/permission-matrix';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

export default function RolesPage() {
  const t = useTranslations('roles');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const toast = useMutationToast();
  const permLabels = getPermissionLabels(locale);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [assignMembershipId, setAssignMembershipId] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rolesQuery = useQuery({
    queryKey: ['roles', tenantId],
    queryFn: listRoles,
    enabled: !!tenantId,
  });
  const catalogQuery = useQuery({
    queryKey: ['permission-catalog', tenantId],
    queryFn: getPermissionCatalog,
    enabled: !!tenantId,
  });
  const membersQuery = useQuery({
    queryKey: ['members', tenantId],
    queryFn: listMembers,
    enabled: !!tenantId,
  });

  const roles = rolesQuery.data ?? [];
  const catalog = catalogQuery.data;
  const canManage = catalog?.canManage === true;
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraftName(selected.name);
    setDraftPerms(new Set(selected.permissions));
    setReassignTo('');
    setBanner(null);
    setError(null);
  }, [selected?.id, selected?.name, selected?.permissions.join('|')]);

  const roleMembers: Member[] = useMemo(
    () => (membersQuery.data ?? []).filter((m) => m.role.id === selected?.id),
    [membersQuery.data, selected?.id],
  );
  const otherMembers = (membersQuery.data ?? []).filter((m) => m.role.id !== selected?.id);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['roles', tenantId] }),
      qc.invalidateQueries({ queryKey: ['members', tenantId] }),
      qc.invalidateQueries({ queryKey: ['permission-catalog', tenantId] }),
    ]);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const body: { name?: string; permissions: string[] } = {
        permissions: [...draftPerms],
      };
      if (!selected.isSystem && draftName.trim() && draftName.trim() !== selected.name) {
        body.name = draftName.trim();
      }
      return updateRole(selected.id, body);
    },
    onSuccess: async () => {
      setBanner(t('saved'));
      await invalidate();
      toast.saved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
      toast.error(err, t('errorGeneric'));
    },
  });

  const createMut = useMutation({
    mutationFn: () => createRole({ name: newName.trim(), permissions: [] }),
    onSuccess: async (role) => {
      setCreating(false);
      setNewName('');
      setSelectedId(role.id);
      await invalidate();
      toast.created();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
      toast.error(err, t('errorGeneric'));
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('no role');
      return deleteRole(
        selected.id,
        selected.memberCount > 0 ? reassignTo || undefined : undefined,
      );
    },
    onSuccess: async () => {
      setSelectedId(null);
      await invalidate();
      toast.deleted();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
      toast.error(err, t('errorGeneric'));
    },
  });

  const assignMut = useMutation({
    mutationFn: () => updateMemberRole(assignMembershipId, selected!.id),
    onSuccess: async () => {
      setAssignMembershipId('');
      await invalidate();
      toast.saved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
      toast.error(err, t('errorGeneric'));
    },
  });

  const forbiddenView =
    (rolesQuery.error instanceof ApiError && rolesQuery.error.status === 403) ||
    (catalogQuery.error instanceof ApiError && catalogQuery.error.status === 403);

  const ownerLocked = selected?.isSystem === true && selected.name === 'Owner';
  const matrixDisabled = !canManage || ownerLocked;

  function toggle(code: string, on: boolean) {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function toggleGroup(codes: string[], on: boolean) {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      for (const code of codes) {
        if (on) next.add(code);
        else next.delete(code);
      }
      return next;
    });
  }

  function retry() {
    void rolesQuery.refetch();
    void catalogQuery.refetch();
    void membersQuery.refetch();
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
        subtitle={t('intro')}
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
            >
              {t('create')}
            </Button>
          ) : null
        }
      />

      {forbiddenView ? (
        <p className="text-token-sm text-danger" role="alert">
          {t('forbidden')}
        </p>
      ) : null}
      {!canManage && !forbiddenView && catalog ? (
        <p className="text-token-sm text-foreground-muted">{t('forbiddenManage')}</p>
      ) : null}
      {error ? (
        <p className="text-token-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {banner ? (
        <p className="text-token-sm text-success" role="status">
          {banner}
        </p>
      ) : null}
      {rolesQuery.isError && !forbiddenView ? (
        <Card className="border-danger" role="alert">
          <p className="text-token-sm text-danger">
            {rolesQuery.error instanceof Error ? rolesQuery.error.message : t('errorGeneric')}
          </p>
          <Button className="mt-token-sm" variant="secondary" size="sm" onClick={retry}>
            {t('retryLoad')}
          </Button>
        </Card>
      ) : null}

      <Modal
        open={creating && canManage}
        onClose={() => setCreating(false)}
        title={t('createTitle')}
      >
        <form
          className="space-y-token-md"
          onSubmit={(e) => {
            e.preventDefault();
            void createMut.mutate();
          }}
        >
          <Input
            label={t('name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('namePlaceholder')}
            required
          />
          <div className="flex flex-wrap gap-token-sm">
            <Button type="submit" disabled={createMut.isPending || !newName.trim()}>
              {t('create')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </Modal>

      {rolesQuery.isLoading ? (
        <div className="grid gap-token-lg md:grid-cols-[16rem_1fr]" aria-busy="true">
          <Card>
            <Skeleton className="mb-token-sm" />
            <Skeleton className="mb-token-sm w-2/3" />
            <Skeleton />
          </Card>
          <Card>
            <Skeleton variant="rect" className="h-token-xl" />
          </Card>
        </div>
      ) : (
        <div className="grid gap-token-lg md:grid-cols-[16rem_1fr]">
          {roles.length ? (
            <ul className="m-0 grid list-none gap-token-sm p-0 sm:grid-cols-2 md:grid-cols-1">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(role.id)}
                    className={
                      'w-full rounded-lg border px-token-sm py-token-sm text-start text-token-sm shadow-sm transition focus-visible:outline-none focus-visible:shadow-ring ' +
                      (role.id === selected?.id
                        ? 'border-brand bg-brand-muted'
                        : 'border-border bg-surface hover:border-brand hover:shadow-brand')
                    }
                  >
                    <span className="font-medium text-foreground">{role.name}</span>
                    <Badge
                      className="ms-token-xs"
                      variant={role.isSystem ? 'info' : 'neutral'}
                    >
                      {role.isSystem ? t('system') : t('custom')}
                    </Badge>
                    <span className="mt-token-xs block text-foreground-muted">
                      {t('memberCount', { count: role.memberCount })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !forbiddenView ? (
            <EmptyState
              title={t('empty')}
              action={
                canManage
                  ? {
                      label: t('create'),
                      onClick: () => {
                        setCreating(true);
                        setError(null);
                      },
                    }
                  : undefined
              }
            />
          ) : (
            <div />
          )}

          {selected ? (
            <Card className="flex flex-col">
              <div className="flex flex-wrap items-center gap-token-sm">
                {selected.isSystem || !canManage ? (
                  <h2 className="m-0 text-token-lg font-semibold text-foreground">{selected.name}</h2>
                ) : (
                  <Input
                    label={t('name')}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                )}
                <Badge variant={selected.isSystem ? 'info' : 'neutral'}>
                  {selected.isSystem ? t('system') : t('custom')}
                </Badge>
              </div>
              {ownerLocked ? (
                <p className="mt-token-sm text-token-sm text-foreground-muted">{t('ownerLocked')}</p>
              ) : selected.isSystem ? (
                <p className="mt-token-sm text-token-sm text-foreground-muted">{t('systemHint')}</p>
              ) : null}

              <PermissionMatrix
                groups={catalog?.groups ?? []}
                labels={permLabels}
                groupLabel={(id) => t(`groups.${id}`)}
                selectAllLabel={t('selectAllGroup')}
                checked={draftPerms}
                disabled={matrixDisabled}
                onToggle={toggle}
                onToggleGroup={toggleGroup}
              />

              {canManage && !ownerLocked ? (
                <div className="sticky bottom-0 mt-token-lg border-t border-border bg-surface pt-token-md">
                  <Button
                    type="button"
                    disabled={saveMut.isPending}
                    onClick={() => {
                      setError(null);
                      setBanner(null);
                      void saveMut.mutate();
                    }}
                  >
                    {saveMut.isPending ? t('saving') : t('save')}
                  </Button>
                </div>
              ) : null}

              <h3 className="mt-token-xl text-token-md font-semibold text-foreground">{t('members')}</h3>
              {roleMembers.length ? (
                <ul className="mt-token-sm space-y-token-xs text-token-sm">
                  {roleMembers.map((m) => (
                    <li key={m.id} className="font-en" dir="ltr">
                      {m.user.email}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-token-sm text-token-sm text-foreground-muted">{t('noMembers')}</p>
              )}

              {canManage ? (
                <form
                  className="mt-token-md flex flex-wrap items-end gap-token-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!assignMembershipId) return;
                    setError(null);
                    void assignMut.mutate();
                  }}
                >
                  <Select
                    label={t('assignMember')}
                    value={assignMembershipId}
                    onChange={(e) => setAssignMembershipId(e.target.value)}
                  >
                    <option value="">—</option>
                    {otherMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.user.email} ({m.role.name})
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" disabled={!assignMembershipId || assignMut.isPending}>
                    {t('assign')}
                  </Button>
                </form>
              ) : null}

              {canManage && !selected.isSystem ? (
                <div className="mt-token-xl border-t border-border pt-token-md">
                  {selected.memberCount > 0 ? (
                    <Select
                      label={t('reassignTo')}
                      value={reassignTo}
                      onChange={(e) => setReassignTo(e.target.value)}
                    >
                      <option value="">—</option>
                      {roles
                        .filter((r) => r.id !== selected.id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </Select>
                  ) : null}
                  <Button
                    type="button"
                    variant="danger"
                    className="mt-token-md"
                    disabled={deleteMut.isPending || (selected.memberCount > 0 && !reassignTo)}
                    onClick={() => {
                      setError(null);
                      void deleteMut.mutate();
                    }}
                  >
                    {t('delete')}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
