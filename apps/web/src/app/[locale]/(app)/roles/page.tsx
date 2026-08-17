'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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

function fieldClass() {
  return 'mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm';
}

export default function RolesPage() {
  const t = useTranslations('roles');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const permLabels = t.raw('perm') as Record<string, string>;

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
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
    },
  });

  const createMut = useMutation({
    mutationFn: () => createRole({ name: newName.trim(), permissions: [] }),
    onSuccess: async (role) => {
      setCreating(false);
      setNewName('');
      setSelectedId(role.id);
      await invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
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
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
    },
  });

  const assignMut = useMutation({
    mutationFn: () => updateMemberRole(assignMembershipId, selected!.id),
    onSuccess: async () => {
      setAssignMembershipId('');
      await invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('errorGeneric'));
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

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-token-md">
        <div>
          <h1 className="font-display text-token-xl">{t('title')}</h1>
          <p className="mt-token-xs max-w-3xl text-token-sm text-foreground/70">{t('intro')}</p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="rounded bg-brand px-token-md py-token-sm text-white"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
          >
            {t('create')}
          </button>
        ) : null}
      </div>

      {forbiddenView ? (
        <p className="mt-token-md text-token-sm text-red-700">{t('forbidden')}</p>
      ) : null}
      {!canManage && !forbiddenView ? (
        <p className="mt-token-md text-token-sm text-foreground/70">{t('forbiddenManage')}</p>
      ) : null}
      {error ? <p className="mt-token-md text-token-sm text-red-700">{error}</p> : null}
      {banner ? <p className="mt-token-md text-token-sm text-green-800">{banner}</p> : null}

      {creating && canManage ? (
        <form
          className="mt-token-lg rounded border border-border bg-surface p-token-md"
          onSubmit={(e) => {
            e.preventDefault();
            void createMut.mutateAsync();
          }}
        >
          <h2 className="font-medium">{t('createTitle')}</h2>
          <label className="mt-token-sm block text-token-sm">
            {t('name')}
            <input
              className={fieldClass()}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('namePlaceholder')}
              required
            />
          </label>
          <div className="mt-token-md flex gap-token-sm">
            <button
              type="submit"
              disabled={createMut.isPending || !newName.trim()}
              className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
            >
              {t('create')}
            </button>
            <button
              type="button"
              className="rounded border border-border px-token-md py-token-sm"
              onClick={() => setCreating(false)}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-token-lg grid gap-token-lg md:grid-cols-[16rem_1fr]">
        <ul className="space-y-token-xs">
          {roles.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => setSelectedId(role.id)}
                className={
                  'w-full rounded border px-token-sm py-token-sm text-start text-token-sm ' +
                  (role.id === selected?.id
                    ? 'border-brand bg-brand/10'
                    : 'border-border bg-surface')
                }
              >
                <span className="font-medium">{role.name}</span>
                <span className="ms-token-xs text-foreground/60">
                  {role.isSystem ? t('system') : t('custom')}
                </span>
                <span className="mt-token-xs block text-foreground/60">
                  {t('memberCount', { count: role.memberCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <div className="rounded border border-border bg-surface p-token-md">
            <div className="flex flex-wrap items-center gap-token-sm">
              {selected.isSystem || !canManage ? (
                <h2 className="font-display text-token-lg">{selected.name}</h2>
              ) : (
                <label className="text-token-sm">
                  {t('name')}
                  <input
                    className={fieldClass()}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                </label>
              )}
              <span className="rounded border border-border px-token-sm py-token-xs text-token-sm">
                {selected.isSystem ? t('system') : t('custom')}
              </span>
            </div>
            {ownerLocked ? (
              <p className="mt-token-sm text-token-sm text-foreground/70">{t('ownerLocked')}</p>
            ) : selected.isSystem ? (
              <p className="mt-token-sm text-token-sm text-foreground/70">{t('systemHint')}</p>
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
              <button
                type="button"
                disabled={saveMut.isPending}
                onClick={() => {
                  setError(null);
                  setBanner(null);
                  void saveMut.mutateAsync();
                }}
                className="mt-token-lg rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
              >
                {saveMut.isPending ? t('saving') : t('save')}
              </button>
            ) : null}

            <h3 className="mt-token-xl font-medium">{t('members')}</h3>
            {roleMembers.length ? (
              <ul className="mt-token-sm space-y-token-xs text-token-sm">
                {roleMembers.map((m) => (
                  <li key={m.id}>{m.user.email}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-token-sm text-token-sm text-foreground/60">{t('noMembers')}</p>
            )}

            {canManage ? (
              <form
                className="mt-token-md flex flex-wrap items-end gap-token-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!assignMembershipId) return;
                  setError(null);
                  void assignMut.mutateAsync();
                }}
              >
                <label className="text-token-sm">
                  {t('assignMember')}
                  <select
                    className={fieldClass()}
                    value={assignMembershipId}
                    onChange={(e) => setAssignMembershipId(e.target.value)}
                  >
                    <option value="">—</option>
                    {otherMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.user.email} ({m.role.name})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={!assignMembershipId || assignMut.isPending}
                  className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
                >
                  {t('assign')}
                </button>
              </form>
            ) : null}

            {canManage && !selected.isSystem ? (
              <div className="mt-token-xl border-t border-border pt-token-md">
                {selected.memberCount > 0 ? (
                  <label className="block text-token-sm">
                    {t('reassignTo')}
                    <select
                      className={fieldClass()}
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
                    </select>
                  </label>
                ) : null}
                <button
                  type="button"
                  className="mt-token-md rounded border border-red-700 px-token-md py-token-sm text-red-800 disabled:opacity-60"
                  disabled={deleteMut.isPending || (selected.memberCount > 0 && !reassignTo)}
                  onClick={() => {
                    setError(null);
                    void deleteMut.mutateAsync();
                  }}
                >
                  {t('delete')}
                </button>
              </div>
            ) : null}
          </div>
        ) : !rolesQuery.isLoading && !forbiddenView ? (
          <p className="text-token-sm text-foreground/60">{t('empty')}</p>
        ) : null}
      </div>
    </section>
  );
}

function PermissionMatrix({
  groups,
  labels,
  groupLabel,
  selectAllLabel,
  checked,
  disabled,
  onToggle,
  onToggleGroup,
}: {
  groups: Array<{ id: string; codes: string[] }>;
  labels: Record<string, string>;
  groupLabel: (id: string) => string;
  selectAllLabel: string;
  checked: Set<string>;
  disabled: boolean;
  onToggle: (code: string, on: boolean) => void;
  onToggleGroup: (codes: string[], on: boolean) => void;
}) {
  return (
    <div className="mt-token-lg space-y-token-md">
      {groups.map((group) => {
        const allOn = group.codes.every((c) => checked.has(c));
        return (
          <fieldset key={group.id} className="rounded border border-border/80 p-token-sm">
            <legend className="px-token-xs font-medium">{groupLabel(group.id)}</legend>
            <label className="mb-token-sm flex items-center gap-token-sm text-token-sm text-foreground/70">
              <input
                type="checkbox"
                checked={allOn}
                disabled={disabled}
                onChange={(e) => onToggleGroup(group.codes, e.target.checked)}
              />
              {selectAllLabel}
            </label>
            <ul className="space-y-token-xs">
              {group.codes.map((code) => (
                <li key={code}>
                  <label className="flex items-start gap-token-sm text-token-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked.has(code)}
                      disabled={disabled}
                      onChange={(e) => onToggle(code, e.target.checked)}
                    />
                    <span>
                      <span className="block">{labels[code] ?? code}</span>
                      <span className="font-mono text-token-sm text-foreground/50" dir="ltr">
                        {code}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
