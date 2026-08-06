import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('sync smoke (T019)', () => {
  it('has sync status labels', () => {
    expect(en.sync.pending).toBeTruthy();
    expect(en.sync.synced).toBeTruthy();
    expect(ar.sync.pending).toBeTruthy();
    expect(ar.sync.offline).toBeTruthy();
  });
});
