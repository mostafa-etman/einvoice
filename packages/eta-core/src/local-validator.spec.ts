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
    expect(
      issues.find((i) => i.code === 'REQUIRED_FIELD' && i.path === 'receiver')
        ?.params?.path,
    ).toBe('receiver');
    expect(issues.some((i) => i.code === 'BRANCH_INACTIVE')).toBe(true);
  });

  it('requires reference for credit notes', () => {
    const issues = validateDocument({
      kind: 'CREDIT_NOTE',
      document: {
        documentType: 'C',
        documentTypeVersion: '1.0',
        dateTimeIssued: '2026-01-01T00:00:00Z',
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

  it('flags dateTimeIssued with milliseconds (PatternMismatch)', () => {
    const issues = validateDocument({
      kind: 'INVOICE',
      document: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        dateTimeIssued: '2026-07-31T09:16:00.000Z',
        issuer: {},
        receiver: {},
        invoiceLines: [],
        internalID: 'VAL-1',
        totalSalesAmount: 100,
      },
      typeVersionSchema: { documentType: 'I', documentTypeVersion: '1.0' },
      refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
    });
    expect(issues.some((i) => i.code === 'ETA_DATETIME_PATTERN')).toBe(true);
  });

  it('flags string amounts as ETA_NUMBER_EXPECTED', () => {
    const issues = validateDocument({
      kind: 'INVOICE',
      document: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        dateTimeIssued: '2026-07-31T09:16:00Z',
        issuer: {},
        receiver: {},
        invoiceLines: [],
        internalID: 'VAL-1',
        totalSalesAmount: '100.00',
        netAmount: '100.00',
      },
      typeVersionSchema: { documentType: 'I', documentTypeVersion: '1.0' },
      refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
    });
    expect(issues.filter((i) => i.code === 'ETA_NUMBER_EXPECTED').length).toBeGreaterThan(0);
  });

  it('allows a fully tax-free invoice but warns on domestic kinds', () => {
    const issues = validateDocument({
      kind: 'INVOICE',
      document: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        dateTimeIssued: '2026-07-31T09:16:00Z',
        issuer: {},
        receiver: {},
        invoiceLines: [{ taxableItems: [] }],
        internalID: 'VAL-FREE',
        totalSalesAmount: 50,
        netAmount: 50,
        totalAmount: 50,
      },
      typeVersionSchema: { documentType: 'I', documentTypeVersion: '1.0' },
      refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
      lines: [
        {
          description: 'Free',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '50.00',
          taxes: [],
        },
      ],
    });
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
    const warn = issues.find((i) => i.code === 'TAX_TYPICALLY_REQUIRED');
    expect(warn?.severity).toBe('warning');
  });

  it('errors when TaxType is duplicated on a line', () => {
    const issues = validateDocument({
      kind: 'INVOICE',
      document: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        dateTimeIssued: '2026-07-31T09:16:00Z',
        issuer: {},
        receiver: {},
        invoiceLines: [],
        internalID: 'VAL-DUP',
      },
      typeVersionSchema: { documentType: 'I', documentTypeVersion: '1.0' },
      refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
      lines: [
        {
          description: 'Dup',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
          taxes: [
            { taxType: 'T1', subType: 'V009', rate: '14' },
            { taxType: 'T1', subType: 'V010', rate: '5' },
          ],
        },
      ],
    });
    expect(issues.some((i) => i.code === 'DUPLICATE_TAX_TYPE')).toBe(true);
  });
});
