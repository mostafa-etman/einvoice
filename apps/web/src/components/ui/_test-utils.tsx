import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from './toast';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

export function renderUi(ui: ReactNode, locale: 'en' | 'ar' = 'en') {
  const source = locale === 'ar' ? ar : en;
  const messages = { common: source.common, ui: source.ui };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>
        <ToastProvider>{ui}</ToastProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}
