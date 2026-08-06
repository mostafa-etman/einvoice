import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('conflict smoke (T039)', () => {
  it('has Conflict UI labels', () => {
    expect(en.conflict.keepLocal).toBeTruthy();
    expect(en.conflict.keepServer).toBeTruthy();
    expect(ar.conflict.merge).toBeTruthy();
  });
});
