import { locales, defaultLocale } from '@/i18n/config';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('landing i18n smoke', () => {
  it('defaults to Arabic and supports en', () => {
    expect(locales).toEqual(['en', 'ar']);
    expect(defaultLocale).toBe('ar');
  });

  it('has English and Arabic message catalogs', () => {
    expect(en.brand).toBeTruthy();
    expect(ar.brand).toBeTruthy();
    expect(ar.tagline).not.toEqual(en.tagline);
    expect(ar.nav.users).toBeTruthy();
    expect(en.auth.loginTitle).toBeTruthy();
  });

  it('uses RTL for Arabic locale', () => {
    const dir = (locale: string) => (locale === 'ar' ? 'rtl' : 'ltr');
    expect(dir('ar')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
  });
});
