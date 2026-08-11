'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { addMember, listMembers } from '@/lib/api/members';
import { listRoles } from '@/lib/api/roles';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';

const schema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
});

type FormValues = z.infer<typeof schema>;

export default function UsersPage() {
  const t = useTranslations('users');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
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
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const invite = useMutation({
    mutationFn: (values: FormValues) => addMember(values.email, values.roleId),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['members', tenantId] });
    },
  });

  const forbidden =
    membersQuery.error instanceof ApiError && membersQuery.error.status === 403;

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <p className="mt-token-xs text-token-sm text-foreground/70">{t('inviteHint')}</p>
      {forbidden ? (
        <p className="mt-token-md text-token-sm text-red-700">{t('forbidden')}</p>
      ) : null}

      <form
        className="mt-token-lg flex flex-wrap items-end gap-token-md"
        onSubmit={handleSubmit((values) => invite.mutateAsync(values))}
      >
        <label className="text-token-sm">
          {t('email')}
          <input
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            type="email"
            {...register('email')}
          />
        </label>
        <label className="text-token-sm">
          {t('role')}
          <select
            className="mt-token-xs block rounded border border-border bg-surface px-token-sm py-token-sm"
            {...register('roleId')}
          >
            <option value="">—</option>
            {(rolesQuery.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isSubmitting || invite.isPending}
          className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
        >
          {t('invite')}
        </button>
      </form>
      {invite.error instanceof ApiError && invite.error.status === 403 ? (
        <p className="mt-token-sm text-token-sm text-red-700">{t('forbidden')}</p>
      ) : null}

      <table className="mt-token-xl w-full border-collapse text-start text-token-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-token-sm">{t('email')}</th>
            <th className="py-token-sm">{t('role')}</th>
          </tr>
        </thead>
        <tbody>
          {(membersQuery.data ?? []).map((m) => (
            <tr key={m.id} className="border-b border-border/60">
              <td className="py-token-sm">{m.user.email}</td>
              <td className="py-token-sm">{m.role.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!membersQuery.isLoading && !(membersQuery.data ?? []).length && !forbidden ? (
        <p className="mt-token-md text-token-sm text-foreground/60">{t('empty')}</p>
      ) : null}
    </section>
  );
}
