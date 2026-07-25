import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('ETA connection smoke', () => {
  it('has status + Test Connection + setup link copy', () => {
    expect(en.settingsEta.connectionStatus).toBeTruthy();
    expect(en.settingsEta.testConnection).toBeTruthy();
    expect(en.settingsEta.setupRequired).toBeTruthy();
    expect(en.settingsEta.setupLink).toBeTruthy();
    expect(ar.settingsEta.testSuccess).toBeTruthy();
    expect(ar.settingsEta.setupLink).toBeTruthy();
  });
});
