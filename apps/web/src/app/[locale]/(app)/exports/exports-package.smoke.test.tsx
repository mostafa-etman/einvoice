import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('exports package page smoke alias (T048)', () => {
  it('package labels present', () => {
    expect(en.exports.etaPackage).toContain('ETA');
    expect(ar.exports.createPackage).toBeTruthy();
  });
});
