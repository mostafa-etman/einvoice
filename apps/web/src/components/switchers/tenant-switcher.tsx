'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useTenant } from '@/lib/tenant-provider';

export function TenantSwitcher() {
  const t = useTranslations('shell');
  const locale = useLocale();
  const { memberships, tenantId, setTenantId, roleName } = useTenant();
  const current = memberships.find((m) => m.tenant.id === tenantId);

  if (!memberships.length) {
    return (
      <span className="text-token-sm text-foreground/60" data-testid="tenant-switcher-empty">
        {t('tenant')}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-token-sm" data-testid="tenant-switcher">
      <label className="text-token-sm">
        {t('tenant')}
        <select
          className="ms-token-sm max-w-[16rem] rounded-control border border-border bg-surface px-token-sm py-token-xs text-token-sm hover:border-brand"
          value={tenantId ?? ''}
          aria-label={t('switchCompany')}
          onChange={(e) => {
            void setTenantId(e.target.value);
          }}
        >
          {memberships.map((m) => (
            <option key={m.tenant.id} value={m.tenant.id}>
              {m.tenant.name} · {m.role.name}
            </option>
          ))}
        </select>
      </label>
      {current && roleName ? (
        <span className="text-token-xs text-foreground/60" data-testid="tenant-switcher-role">
          {roleName}
        </span>
      ) : null}
      <Link
        href={`/${locale}/onboarding`}
        className="text-token-sm text-brand underline"
        data-testid="tenant-switcher-create"
      >
        {t('createCompany')}
      </Link>
    </div>
  );
}
