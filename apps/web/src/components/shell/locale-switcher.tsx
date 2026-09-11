'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

export function LocaleSwitcher() {
  const t = useTranslations('shell');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const switchLocale = (next: string) => {
    const rest = pathname.replace(/^\/(ar|en)/, '') || '';
    router.replace(`/${next}${rest}`);
  };

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
