import {
  canCreateReturnCreditNote,
  canPrepareDocumentForSubmit,
} from './document-actions';

describe('canPrepareDocumentForSubmit', () => {
  it('allows draft / ready / pending signature for local documents', () => {
    expect(canPrepareDocumentForSubmit('LOCAL', 'DRAFT')).toBe(true);
    expect(canPrepareDocumentForSubmit('LOCAL', 'READY')).toBe(true);
    expect(canPrepareDocumentForSubmit('LOCAL', 'PENDING_SIGNATURE')).toBe(true);
  });

  it('hides pre-submission actions after submit / acceptance / cancel', () => {
    for (const status of [
      'SIGNED',
      'SUBMITTED',
      'VALID',
      'INVALID',
      'CANCELLED',
      'REJECTED',
    ]) {
      expect(canPrepareDocumentForSubmit('LOCAL', status)).toBe(false);
    }
  });

  it('never shows pre-submission actions on historical ETA imports', () => {
    expect(canPrepareDocumentForSubmit('ETA_SYNC', 'DRAFT')).toBe(false);
    expect(canPrepareDocumentForSubmit('ETA_SYNC', 'VALID')).toBe(false);
  });
});

describe('canCreateReturnCreditNote', () => {
  it('allows a VALID invoice with an ETA UUID', () => {
    expect(canCreateReturnCreditNote('INVOICE', 'VALID', 'uuid-1')).toBe(true);
    expect(
      canCreateReturnCreditNote('EXPORT_INVOICE', 'VALID', 'uuid-1'),
    ).toBe(true);
  });

  it('rejects drafts, credit notes, and invoices without a UUID', () => {
    expect(canCreateReturnCreditNote('INVOICE', 'DRAFT', 'uuid-1')).toBe(false);
    expect(canCreateReturnCreditNote('CREDIT_NOTE', 'VALID', 'uuid-1')).toBe(
      false,
    );
    expect(canCreateReturnCreditNote('INVOICE', 'VALID', null)).toBe(false);
  });
});
