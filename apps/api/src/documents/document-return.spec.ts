import { isValidEtaInternalId } from '@einvoice/eta-core';
import {
  creditNoteKindForInvoice,
  returnCreditNoteInternalId,
} from './document-return';

describe('creditNoteKindForInvoice', () => {
  it('maps local and export invoices to the matching credit note', () => {
    expect(creditNoteKindForInvoice('INVOICE')).toBe('CREDIT_NOTE');
    expect(creditNoteKindForInvoice('EXPORT_INVOICE')).toBe('EXPORT_CREDIT_NOTE');
  });

  it('rejects kinds that are not invoices', () => {
    expect(creditNoteKindForInvoice('CREDIT_NOTE')).toBeNull();
    expect(creditNoteKindForInvoice('DEBIT_NOTE')).toBeNull();
  });
});

describe('returnCreditNoteInternalId', () => {
  it('produces an ETA-safe id derived from the source', () => {
    const id = returnCreditNoteInternalId('INV-000001', 1_725_000_000_000);
    expect(isValidEtaInternalId(id)).toBe(true);
    expect(id.startsWith('CN')).toBe(true);
    expect(id).toContain('INV-000001');
  });
});
