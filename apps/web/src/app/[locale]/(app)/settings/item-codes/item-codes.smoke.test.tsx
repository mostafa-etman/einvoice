import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('item codes smoke', () => {
  it('has sync and provenance labels', () => {
    expect(en.settingsItemCodes.syncEta).toBeTruthy();
    expect(en.settingsItemCodes.sourceLocal).toBeTruthy();
    expect(en.settingsItemCodes.sourceEta).toBeTruthy();
    expect(ar.settingsItemCodes.create).toBeTruthy();
    expect(ar.settingsItemCodes.syncRunning).toBeTruthy();
  });
});
