import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('devices page smoke', () => {
  it('has devices nav and page copy in both locales', () => {
    expect(en.nav.devices).toBeTruthy();
    expect(ar.nav.devices).toBeTruthy();
    expect(en.devices.title).toBeTruthy();
    expect(en.devices.createPairingCode).toBeTruthy();
    expect(en.devices.unpair).toBeTruthy();
    expect(ar.devices.pairingCodeOnce).toBeTruthy();
    expect(ar.devices.empty).toBeTruthy();
  });
});
