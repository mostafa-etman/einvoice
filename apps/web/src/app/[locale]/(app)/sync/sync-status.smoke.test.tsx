import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('sync-status smoke (T045)', () => {
  it('has status + nav copy en/ar', () => {
    expect(en.nav.sync).toBeTruthy();
    expect(ar.nav.sync).toBeTruthy();
    expect(en.sync.status.pending).toBeTruthy();
    expect(ar.sync.status.conflict).toBeTruthy();
  });
});
