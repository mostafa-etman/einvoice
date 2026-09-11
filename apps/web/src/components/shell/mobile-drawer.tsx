'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Drawer } from '@/components/ui/drawer';
import { XiraLogo } from '@/components/brand/xira-logo';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

export function MobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('shell');
  const pathname = usePathname();

  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('navigation')}
      side="start"
      tone="on-dark"
      className="max-w-sidebar"
      footer={<UserMenu tone="on-dark" />}
    >
      <div className="flex flex-col gap-token-lg">
        <XiraLogo variant="on-dark" size="sm" />
        <SidebarNav onNavigate={onClose} />
      </div>
    </Drawer>
  );
}
