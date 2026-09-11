'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { registerLogoutUnsyncedConfirm } from '@/lib/logout-unsynced-confirm';

type Pending = {
  count: number;
  resolve: (ok: boolean) => void;
};

export function LogoutUnsyncedDialog() {
  const t = useTranslations('auth');
  const tNav = useTranslations('nav');
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    return registerLogoutUnsyncedConfirm(
      (count) =>
        new Promise<boolean>((resolve) => {
          setPending({ count, resolve });
        }),
    );
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      danger
      title={t('logoutUnsyncedTitle')}
      description={t('logoutUnsyncedBody', { count: pending?.count ?? 0 })}
      confirmLabel={tNav('logout')}
      onClose={() => close(false)}
      onConfirm={() => close(true)}
    />
  );
}
