import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('ETA credentials smoke', () => {
  it('has masked secret and rotate controls copy', () => {
    expect(en.settingsEta.secretMasked).toBeTruthy();
    expect(en.settingsEta.rotate).toBeTruthy();
    expect(ar.settingsEta.testConnection).toBeTruthy();
  });

  it('has taxpayer legal name labels in both locales', () => {
    for (const messages of [en, ar]) {
      expect(messages.settingsEta.taxpayerLegalName).toBeTruthy();
      expect(messages.settingsEta.taxpayerLegalNameHelp).toBeTruthy();
      expect(messages.settingsEta.companyIdentity).toBeTruthy();
      expect(messages.settingsEta.issuerIdentityIncomplete).toBeTruthy();
    }
  });

  it('has environment switch, go-live, and clear-sandbox copy', () => {
    for (const messages of [en, ar]) {
      expect(messages.settingsEta.badgeSandbox).toBeTruthy();
      expect(messages.settingsEta.badgeProduction).toBeTruthy();
      expect(messages.settingsEta.goLiveTitle).toBeTruthy();
      expect(messages.settingsEta.clearSandboxTitle).toBeTruthy();
      expect(messages.settingsEta.clearSandboxIrreversible).toBeTruthy();
      expect(messages.shell.etaEnvSandbox).toBeTruthy();
      expect(messages.shell.etaEnvProduction).toBeTruthy();
    }
  });
});
