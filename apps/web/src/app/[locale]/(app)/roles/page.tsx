'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { listRoles } from '@/lib/api/roles';
import { ApiError } from '@/lib/api/client';
import { useTenant } from '@/lib/tenant-provider';

export default function RolesPage() {
  const t = useTranslations('roles');
  const { tenantId } = useTenant();
  const rolesQuery = useQuery({
    queryKey: ['roles', tenantId],
    queryFn: listRoles,
    enabled: !!tenantId,
  });

  const forbidden =
    rolesQuery.error instanceof ApiError && rolesQuery.error.status === 403;

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      {forbidden ? (
        <p className="mt-token-md text-token-sm text-red-700">{t('forbidden')}</p>
      ) : null}
      <ul className="mt-token-lg space-y-token-md">
        {(rolesQuery.data ?? []).map((role) => (
          <li key={role.id} className="rounded border border-border bg-surface p-token-md">
            <p className="font-medium">{role.name}</p>
            <p className="mt-token-xs text-token-sm text-foreground/70">
              {t('permissions')}: {role.permissions.join(', ')}
            </p>
          </li>
        ))}
      </ul>
      {!rolesQuery.isLoading && !(rolesQuery.data ?? []).length && !forbidden ? (
        <p className="mt-token-md text-token-sm text-foreground/60">{t('empty')}</p>
      ) : null}
    </section>
  );
}
