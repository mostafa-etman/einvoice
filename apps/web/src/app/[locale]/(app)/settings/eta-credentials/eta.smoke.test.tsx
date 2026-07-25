import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('ETA credentials smoke', () => {
  it('has masked secret and rotate controls copy', () => {
    expect(en.settingsEta.secretMasked).toBeTruthy();
    expect(en.settingsEta.rotate).toBeTruthy();
    expect(ar.settingsEta.testConnection).toBeTruthy();
  });
});
