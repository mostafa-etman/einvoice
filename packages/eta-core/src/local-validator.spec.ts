import { validateDocument } from './local-validator.js';

describe('LocalValidator', () => {
  it('flags missing required paths and bad refs', () => {
    const issues = validateDocument({
      kind: 'INVOICE',
      document: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        issuer: { name: 'A' },
      },
      typeVersionSchema: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        requiredPaths: ['issuer', 'receiver', 'invoiceLines'],
      },
      refs: {
        branchOk: false,
        currencyOk: true,
        itemCodesOk: true,
      },
    });
    expect(issues.some((i) => i.code === 'REQUIRED_FIELD')).toBe(true);
    expect(issues.some((i) => i.code === 'BRANCH_INACTIVE')).toBe(true);
  });

  it('requires reference for credit notes', () => {
    const issues = validateDocument({
      kind: 'CREDIT_NOTE',
      document: {
        documentType: 'C',
        documentTypeVersion: '1.0',
        issuer: {},
        receiver: {},
        invoiceLines: [],
        internalID: '1',
      },
      typeVersionSchema: { documentType: 'C', documentTypeVersion: '1.0' },
      refs: {
        branchOk: true,
        currencyOk: true,
        itemCodesOk: true,
        originalDocumentOk: false,
      },
    });
    expect(issues.some((i) => i.code === 'REFERENCE_REQUIRED')).toBe(true);
  });
});
