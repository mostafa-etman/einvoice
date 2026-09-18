import { matchAppScreen, stripLocalePrefix, isAppScreenKey } from './app-screens.js';

describe('app screens', () => {
  it('strips locale prefixes', () => {
    expect(stripLocalePrefix('/en/documents')).toBe('/documents');
    expect(stripLocalePrefix('/ar')).toBe('/');
    expect(stripLocalePrefix('/documents')).toBe('/documents');
  });

  it('matches the most specific screen for a path', () => {
    expect(matchAppScreen('/en')).toBe('home');
    expect(matchAppScreen('/ar/documents')).toBe('documents');
    expect(matchAppScreen('/en/receipts')).toBe('receipts');
    expect(matchAppScreen('/en/receipts/abc')).toBe('receipts.detail');
    expect(matchAppScreen('/en/documents/abc')).toBe('documents.detail');
    expect(matchAppScreen('/en/settings/eta-credentials')).toBe('settings.eta-credentials');
    expect(matchAppScreen('/en/settings/pos-devices')).toBe('settings.pos-devices');
    expect(matchAppScreen('/en/settings')).toBe('settings');
    expect(matchAppScreen('/en/sync/conflict')).toBe('sync.conflict');
    expect(matchAppScreen('/en/unknown-page')).toBe('other');
  });

  it('accepts catalog keys only', () => {
    expect(isAppScreenKey('documents')).toBe(true);
    expect(isAppScreenKey('not-a-screen')).toBe(false);
  });
});
