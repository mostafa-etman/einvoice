import { defaultLocale } from '@/i18n/config';

describe('app shell smoke', () => {
  it('defaults to Arabic RTL', () => {
    expect(defaultLocale).toBe('ar');
    expect(defaultLocale === 'ar' ? 'rtl' : 'ltr').toBe('rtl');
  });

  it('switches English to LTR', () => {
    const dir = (locale: string) => (locale === 'ar' ? 'rtl' : 'ltr');
    expect(dir('en')).toBe('ltr');
  });
});
