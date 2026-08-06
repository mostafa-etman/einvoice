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

  it('has sidebar collapse labels in both locales', async () => {
    const en = (await import('@/messages/en.json')).default;
    const ar = (await import('@/messages/ar.json')).default;
    expect(en.shell.collapseSidebar).toBeTruthy();
    expect(en.shell.expandSidebar).toBeTruthy();
    expect(ar.shell.collapseSidebar).toBeTruthy();
    expect(ar.shell.expandSidebar).toBeTruthy();
  });
});
