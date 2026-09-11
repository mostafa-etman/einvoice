'use client';

import { useTheme } from '@/components/theme-provider';
import { useTranslations } from 'next-intl';

export function ThemeToggle() {
  const t = useTranslations('shell');
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={t('themeToggle')}
      title={t('themeToggle')}
      className="rounded-control p-token-sm text-foreground-muted hover:bg-surface-hover hover:text-foreground"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-token-md w-token-md" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.2 6.2 4.8 4.8M19.2 19.2l-1.4-1.4M6.2 17.8 4.8 19.2M19.2 4.8l-1.4 1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-token-md w-token-md" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <path d="M21 14.3A8.5 8.5 0 1 1 9.7 3 7 7 0 0 0 21 14.3z" />
        </svg>
      )}
    </button>
  );
}
