import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('settings branches smoke', () => {
  it('has branch settings labels', () => {
    expect(en.settingsBranches.create).toBeTruthy();
    expect(ar.settingsBranches.title).toBeTruthy();
  });

  it('has issuer address labels in both locales', () => {
    for (const messages of [en, ar]) {
      expect(messages.settingsBranches.issuerAddress).toBeTruthy();
      expect(messages.settingsBranches.issuerAddressHelp).toBeTruthy();
      expect(messages.settingsBranches.governate).toBeTruthy();
      expect(messages.settingsBranches.regionCity).toBeTruthy();
      expect(messages.settingsBranches.street).toBeTruthy();
      expect(messages.settingsBranches.buildingNumber).toBeTruthy();
      expect(messages.settingsBranches.addressIncomplete).toBeTruthy();
    }
  });

  it('points issuer validation errors at the right settings area', () => {
    for (const messages of [en, ar]) {
      expect(messages.documents.issuerFromSettingsTitle).toBeTruthy();
      expect(messages.documents.issuerFromSettingsBody).toBeTruthy();
      expect(messages.documents.issuerFromSettingsLink).toBeTruthy();
      expect(messages.documents.issuerFromSettingsLinkEta).toBeTruthy();
    }
  });
});
