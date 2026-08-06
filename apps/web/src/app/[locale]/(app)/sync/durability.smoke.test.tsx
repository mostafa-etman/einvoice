import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('durability smoke (T052)', () => {
  it('has discard warning copy', () => {
    expect(en.sync.discardWarn).toBeTruthy();
    expect(ar.sync.discardWarn).toBeTruthy();
    expect(en.offline.browserWipeRisk).toBeTruthy();
  });
});
