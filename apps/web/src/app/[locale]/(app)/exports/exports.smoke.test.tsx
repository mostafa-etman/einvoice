import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('exports center smoke (T039)', () => {
  it('has Export Center create/track labels', () => {
    expect(en.nav.exports).toBeTruthy();
    expect(en.exports.title).toBeTruthy();
    expect(en.exports.local).toBeTruthy();
    expect(en.exports.createLocal).toBeTruthy();
    expect(en.exports.formats).toBeTruthy();
    expect(en.exports.download).toBeTruthy();
    expect(en.exports.status).toBeTruthy();
    expect(ar.nav.exports).toBeTruthy();
    expect(ar.exports.title).toBeTruthy();
    expect(ar.exports.createLocal).toBeTruthy();
  });
});

describe('exports package smoke (T048)', () => {
  it('has ETA package request form + status copy', () => {
    expect(en.exports.etaPackage).toBeTruthy();
    expect(en.exports.createPackage).toBeTruthy();
    expect(en.exports.packageStatus).toBeTruthy();
    expect(en.exports.from).toBeTruthy();
    expect(en.exports.to).toBeTruthy();
    expect(ar.exports.etaPackage).toBeTruthy();
    expect(ar.exports.packageStatus).toBeTruthy();
  });
});

describe('exports history smoke (T056)', () => {
  it('has history table labels', () => {
    expect(en.exports.history).toBeTruthy();
    expect(en.exports.kind).toBeTruthy();
    expect(en.exports.noJobs).toBeTruthy();
    expect(ar.exports.history).toBeTruthy();
  });
});
