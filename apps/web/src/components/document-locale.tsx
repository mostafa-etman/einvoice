'use client';

import { useEffect } from 'react';

/** Keeps <html lang/dir> in sync when [locale] changes without remounting auth. */
export function DocumentLocale({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  return null;
}
