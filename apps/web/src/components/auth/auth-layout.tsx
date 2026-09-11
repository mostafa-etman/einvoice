'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { LocaleSwitcher } from '@/components/shell/locale-switcher';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { AuthHero } from './auth-hero';

export function AuthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wide = /\/onboarding\/?$/.test(pathname);

  return (
    <div
      className={cn(
        'grid min-h-screen min-w-0 overflow-x-hidden bg-surface',
        'grid-cols-1',
        wide ? 'lg:grid-cols-[1fr_minmax(var(--size-auth-form),var(--size-auth-form-wide))]' : 'lg:grid-cols-[1fr_var(--size-auth-form)]',
      )}
    >
      <AuthHero />
      <aside className="flex min-w-0 flex-col bg-surface px-auth-form-x-sm py-auth-form-y-sm lg:max-h-screen lg:overflow-y-auto lg:px-auth-form-x lg:py-auth-form-y">
        <div className="my-auto w-full min-w-0">
          <div className="mb-token-2xl flex items-center justify-end gap-token-sm">
            <ThemeToggle />
            <LocaleSwitcher variant="pills" />
          </div>
          {children}
        </div>
      </aside>
    </div>
  );
}
