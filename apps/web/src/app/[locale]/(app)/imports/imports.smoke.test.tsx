import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('imports wizard smoke (T021)', () => {
  it('has Import Wizard labels/steps in en + ar', () => {
    expect(en.nav.imports).toBeTruthy();
    expect(en.imports.title).toBeTruthy();
    expect(en.imports.upload).toBeTruthy();
    expect(en.imports.mapping).toBeTruthy();
    expect(en.imports.validate).toBeTruthy();
    expect(en.imports.validationReport).toBeTruthy();
    expect(en.imports.partialSuccess).toBeTruthy();
    expect(en.imports.runSignSubmit).toBeTruthy();
    expect(en.imports.downloadTemplate).toBeTruthy();
    expect(en.imports.templateHelp).toBeTruthy();
    expect(en.imports.branch).toBeTruthy();
    expect(en.imports.runSignSubmitHelp).toBeTruthy();
    expect(ar.nav.imports).toBeTruthy();
    expect(ar.imports.title).toBeTruthy();
    expect(ar.imports.partialSuccess).toBeTruthy();
    expect(ar.imports.runCreateOnly).toBeTruthy();
    expect(ar.imports.templateHelp).toBeTruthy();
    expect(ar.imports.branch).toBeTruthy();
  });
});

describe('imports mapping smoke (T032)', () => {
  it('exposes required-unmapped copy', () => {
    expect(en.imports.requiredUnmapped).toBeTruthy();
    expect(en.imports.targetField).toBeTruthy();
    expect(en.imports.sourceColumn).toBeTruthy();
    expect(ar.imports.requiredUnmapped).toBeTruthy();
  });
});

describe('imports history smoke (T056)', () => {
  it('has history labels', () => {
    expect(en.imports.history).toBeTruthy();
    expect(en.imports.noJobs).toBeTruthy();
    expect(en.imports.validRows).toBeTruthy();
    expect(ar.imports.history).toBeTruthy();
  });
});
