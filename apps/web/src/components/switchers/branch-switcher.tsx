'use client';

import { useTranslations } from 'next-intl';
import { useTenant } from '@/lib/tenant-provider';

export function BranchSwitcher() {
  const t = useTranslations('shell');
  const { branches, branchId, setBranchId } = useTenant();

  if (!branches.length) {
    return (
      <span className="text-token-sm text-foreground/60" data-testid="branch-switcher-empty">
        {t('branch')}
      </span>
    );
  }

  return (
    <label className="text-token-sm" data-testid="branch-switcher">
      {t('branch')}
      <select
        className="ms-token-sm rounded-control border border-border bg-surface px-token-sm py-token-xs text-token-sm hover:border-brand"
        value={branchId ?? ''}
        onChange={(e) => setBranchId(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
