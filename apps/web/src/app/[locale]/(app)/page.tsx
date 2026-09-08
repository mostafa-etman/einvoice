'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { getEtaSetupStatus } from '@/lib/api/eta-credentials';
import { useTenant } from '@/lib/tenant-provider';

export default function HomePage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { roleName, tenantId } = useTenant();
  const [ready, setReady] = useState(!tenantId);

  useEffect(() => {
    if (!tenantId) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void getEtaSetupStatus()
      .then((setup) => {
        if (cancelled) return;
        if (setup.promptEtaSetup) {
          router.replace(`/${locale}/settings/eta-credentials`);
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, locale, router]);

  if (!ready) {
    return (
      <section>
        <p className="text-token-sm text-foreground/70">…</p>
      </section>
    );
  }

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
