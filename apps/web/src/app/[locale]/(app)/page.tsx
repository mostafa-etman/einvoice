'use client';

import { useTranslations } from 'next-intl';
import { useTenant } from '@/lib/tenant-provider';

export default function HomePage() {
  const t = useTranslations();
  const { roleName, tenantId } = useTenant();

  return (
    <section>
      <h1 className="font-display text-token-xl text-brand">{t('brand')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/80">{t('tagline')}</p>
      <p className="mt-token-lg text-token-sm text-foreground/70">
        {tenantId ? `${roleName ?? ''} · ${tenantId}` : t('cta')}
      </p>
    </section>
  );
}
