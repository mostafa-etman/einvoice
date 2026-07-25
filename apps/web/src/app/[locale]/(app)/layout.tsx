'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { useAuth } from '@/lib/auth-provider';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/${locale}/login`);
    }
  }, [ready, user, locale, router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-token-sm text-foreground/70">
        …
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
