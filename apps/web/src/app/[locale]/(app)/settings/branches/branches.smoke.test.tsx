import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('settings branches smoke', () => {
  it('has branch settings labels', () => {
    expect(en.settingsBranches.create).toBeTruthy();
    expect(ar.settingsBranches.title).toBeTruthy();
  });
});
