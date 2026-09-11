'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export function LocaleSwitcher({ variant = 'select' }: { variant?: 'select' | 'pills' }) {
  const t = useTranslations('shell');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const switchLocale = (next: string) => {
    const rest = pathname.replace(/^\/(ar|en)/, '') || '';
    router.replace(`/${next}${rest}`);
  };

  if (variant === 'pills') {
    return (
      <div
        className="flex gap-token-2xs rounded-control border border-border bg-surface-alt p-token-2xs"
        role="group"
        aria-label={t('language')}
      >
        {(['en', 'ar'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => switchLocale(code)}
            aria-pressed={locale === code}
            className={cn(
              'rounded-sm px-token-sm py-token-2xs text-token-xs transition',
              locale === code
                ? 'bg-surface font-medium text-foreground shadow-xs'
                : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {code === 'ar' ? 'العربية' : 'English'}
          </button>
        ))}
      </div>
    );
  }

  return (
    <label className="text-token-sm text-foreground-muted">
      {t('language')}
      <select
        className="ms-token-sm rounded-control border border-border bg-surface px-token-sm py-token-xs text-token-sm text-foreground hover:border-brand"
        value={locale}
        onChange={(e) => switchLocale(e.target.value)}
        aria-label={t('language')}
      >
        <option value="ar">العربية</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
