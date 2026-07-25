'use client';

import { useTranslations } from 'next-intl';
import { useTenant } from '@/lib/tenant-provider';

export function TenantSwitcher() {
  const t = useTranslations('shell');
  const { memberships, tenantId, setTenantId } = useTenant();

  if (!memberships.length) {
    return (
      <span className="text-token-sm text-foreground/60" data-testid="tenant-switcher-empty">
        {t('tenant')}
      </span>
    );
  }

  return (
    <label className="text-token-sm" data-testid="tenant-switcher">
      {t('tenant')}
      <select
        className="ms-token-sm rounded border border-border bg-background px-token-sm py-token-xs"
        value={tenantId ?? ''}
        onChange={(e) => setTenantId(e.target.value)}
      >
        {memberships.map((m) => (
          <option key={m.tenant.id} value={m.tenant.id}>
            {m.tenant.name}
          </option>
        ))}
      </select>
    </label>
  );
}
