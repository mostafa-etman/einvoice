import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('settings POS devices smoke', () => {
  it('has tenant self-service POS copy in both locales', () => {
    for (const messages of [en, ar]) {
      expect(messages.settingsPosDevices.title).toBeTruthy();
      expect(messages.settingsPosDevices.intro).toBeTruthy();
      expect(messages.settingsPosDevices.b2cSelfService).toBeTruthy();
      expect(messages.settingsPosDevices.serialNumber).toBeTruthy();
      expect(messages.settingsPosDevices.preSharedKey).toBeTruthy();
      expect(messages.settingsPosDevices.osVersion).toBeTruthy();
      expect(messages.settingsPosDevices.modelFramework).toBeTruthy();
      expect(messages.settingsPosDevices.statusPermanentlyRetired).toBeTruthy();
      expect(messages.settingsPosDevices.lastReceiptUuid).toBeTruthy();
      expect(messages.screens['settings_pos-devices']).toBeTruthy();
    }
  });
});
