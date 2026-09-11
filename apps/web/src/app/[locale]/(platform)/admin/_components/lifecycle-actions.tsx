'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { LifecycleStatus } from '@/lib/api/platform-admin';

export function LifecycleActions({
  status,
  onView,
  onApprove,
  onReject,
  onActivate,
  onSuspend,
}: {
  status: LifecycleStatus;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
  onActivate: () => void;
  onSuspend: () => void;
}) {
  const t = useTranslations('admin');

  return (
    <div className="flex flex-wrap gap-token-xs">
      <Button type="button" variant="ghost" size="sm" onClick={onView}>
        {t('viewDetails')}
      </Button>
      {status === 'PENDING' ? (
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onApprove}>
            {t('approve')}
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={onReject}>
            {t('reject')}
          </Button>
        </>
      ) : null}
      {status === 'SUSPENDED' ? (
        <Button type="button" variant="secondary" size="sm" onClick={onActivate}>
          {t('activate')}
        </Button>
      ) : null}
      {status === 'ACTIVE' ? (
        <Button type="button" variant="danger" size="sm" onClick={onSuspend}>
          {t('suspend')}
        </Button>
      ) : null}
    </div>
  );
}
