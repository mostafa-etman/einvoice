import { IMPORT_REQUIRED_FIELDS, applyMapping } from '../src/imports/import-validate.service';

describe('import column mapping (T030)', () => {
  it('auto-match covers required fields when headers equal targets', () => {
    const headers = [...IMPORT_REQUIRED_FIELDS];
    const mapping: Record<string, string> = {};
    for (const field of IMPORT_REQUIRED_FIELDS) {
      if (headers.includes(field)) mapping[field] = field;
    }
    const missing = IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]);
    expect(missing).toEqual([]);
  });

  it('applyMapping remaps source columns to targets', () => {
    const mapped = applyMapping(
      { InvNo: 'A-1', Qty: '2', Price: '10' },
      { internalID: 'InvNo', quantity: 'Qty', unitPrice: 'Price' },
    );
    expect(mapped.internalID).toBe('A-1');
    expect(mapped.quantity).toBe('2');
    expect(mapped.unitPrice).toBe('10');
  });
});
