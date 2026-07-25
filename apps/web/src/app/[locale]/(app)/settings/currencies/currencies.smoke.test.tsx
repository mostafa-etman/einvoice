import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('settings currencies smoke', () => {
  it('has currency settings labels', () => {
    expect(en.settingsCurrencies.addRate).toBeTruthy();
    expect(ar.settingsCurrencies.catalog).toBeTruthy();
  });
});
