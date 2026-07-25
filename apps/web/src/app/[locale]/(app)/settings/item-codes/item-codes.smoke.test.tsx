import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('item codes smoke', () => {
  it('has item code labels and disabled sync copy', () => {
    expect(en.settingsItemCodes.syncDisabled).toBeTruthy();
    expect(ar.settingsItemCodes.create).toBeTruthy();
  });
});
