import {
  canCreateReturnCreditNote,
  canEditDocument,
  canPrepareDocumentForSubmit,
  invoiceKindForNote,
  mapCreditNoteReferenceItems,
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

describe('canEditDocument', () => {
  it('allows draft and ready local documents', () => {
    expect(canEditDocument('LOCAL', 'DRAFT')).toBe(true);
    expect(canEditDocument('LOCAL', 'READY')).toBe(true);
    expect(canEditDocument('FILE_IMPORT', 'DRAFT')).toBe(true);
  });

  it('locks VALID, submitted, cancelled, rejected, and signed documents', () => {
    for (const status of [
      'SIGNED',
      'SUBMITTED',
      'VALID',
      'INVALID',
      'CANCELLED',
      'REJECTED',
      'PENDING_SIGNATURE',
    ]) {
      expect(canEditDocument('LOCAL', status)).toBe(false);
    }
  });

  it('never allows editing historical ETA imports', () => {
    expect(canEditDocument('ETA_SYNC', 'DRAFT')).toBe(false);
    expect(canEditDocument('ETA_SYNC', 'VALID')).toBe(false);
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

describe('invoiceKindForNote', () => {
  it('maps credit and debit notes onto the matching sales invoice kind', () => {
    expect(invoiceKindForNote('CREDIT_NOTE')).toBe('INVOICE');
    expect(invoiceKindForNote('DEBIT_NOTE')).toBe('INVOICE');
    expect(invoiceKindForNote('EXPORT_CREDIT_NOTE')).toBe('EXPORT_INVOICE');
    expect(invoiceKindForNote('EXPORT_DEBIT_NOTE')).toBe('EXPORT_INVOICE');
  });

  it('rejects kinds that are not notes', () => {
    expect(invoiceKindForNote('INVOICE')).toBeNull();
    expect(invoiceKindForNote('PURCHASE_INVOICE')).toBeNull();
  });
});

describe('mapCreditNoteReferenceItems', () => {
  it('keeps VALID invoices with an ETA UUID and drops everything else', () => {
    const mapped = mapCreditNoteReferenceItems([
      {
        id: '1',
        kind: 'INVOICE',
        status: 'VALID',
        etaUuid: 'uuid-old',
        internalId: 'INV-1',
        issueDateTime: '2026-01-01T00:00:00.000Z',
        totalAmount: '10',
      },
      {
        id: '2',
        kind: 'INVOICE',
        status: 'INVALID',
        etaUuid: 'uuid-bad',
        internalId: 'INV-2',
      },
      {
        id: '3',
        kind: 'CREDIT_NOTE',
        status: 'VALID',
        etaUuid: 'uuid-cn',
        internalId: 'CN-1',
      },
      {
        id: '4',
        kind: 'INVOICE',
        status: 'VALID',
        etaUuid: null,
        internalId: 'INV-4',
      },
      {
        id: '5',
        kind: 'INVOICE',
        status: 'DRAFT',
        etaStatus: 'Valid',
        etaUuid: 'uuid-synced',
        internalId: 'INV-5',
      },
    ]);
    expect(mapped.map((c) => c.etaUuid)).toEqual(['uuid-old', 'uuid-synced']);
  });
});
