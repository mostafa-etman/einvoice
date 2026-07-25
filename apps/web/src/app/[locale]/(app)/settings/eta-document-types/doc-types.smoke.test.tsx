import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('ETA document types smoke', () => {
  it('has viewer copy in ar/en', () => {
    expect(en.settingsEtaDocTypes.title).toBeTruthy();
    expect(en.settingsEtaDocTypes.refresh).toBeTruthy();
    expect(ar.settingsEtaDocTypes.intro).toBeTruthy();
    expect(ar.settingsEtaDocTypes.versions).toBeTruthy();
  });
});
