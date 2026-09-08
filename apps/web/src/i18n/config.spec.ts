import {
  defaultLocale,
  localePrefix,
  locales,
  isLocalePrefixedPath,
  withDefaultLocalePrefix,
} from './config';

describe('i18n routing', () => {
  it('defaults to Arabic with always-prefixed locales', () => {
    expect(locales).toEqual(['en', 'ar']);
    expect(defaultLocale).toBe('ar');
    expect(localePrefix).toBe('always');
  });

  it('sends the bare domain and /login into /ar', () => {
    expect(withDefaultLocalePrefix('/')).toBe('/ar');
    expect(withDefaultLocalePrefix('/login')).toBe('/ar/login');
    expect(withDefaultLocalePrefix('/documents')).toBe('/ar/documents');
  });

  it('leaves /ar and /en paths unchanged', () => {
    expect(isLocalePrefixedPath('/ar')).toBe(true);
    expect(isLocalePrefixedPath('/en')).toBe(true);
    expect(isLocalePrefixedPath('/ar/login')).toBe(true);
    expect(isLocalePrefixedPath('/en/documents')).toBe(true);
    expect(isLocalePrefixedPath('/login')).toBe(false);
    expect(isLocalePrefixedPath('/')).toBe(false);
    expect(withDefaultLocalePrefix('/ar')).toBe('/ar');
    expect(withDefaultLocalePrefix('/en')).toBe('/en');
    expect(withDefaultLocalePrefix('/ar/login')).toBe('/ar/login');
    expect(withDefaultLocalePrefix('/en/login')).toBe('/en/login');
  });
});
