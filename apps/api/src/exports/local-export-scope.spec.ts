import {
  ISSUED_DOCUMENT_TYPES,
  RECEIVED_DOCUMENT_TYPES,
  splitLocalExportDocumentTypes,
} from './local-export-scope';

describe('splitLocalExportDocumentTypes', () => {
  it('keeps omitted documentTypes as issued-only (legacy All-sales semantics)', () => {
    expect(splitLocalExportDocumentTypes(undefined)).toEqual({
      issuedKinds: 'all',
      receivedKinds: 'none',
    });
    expect(splitLocalExportDocumentTypes([])).toEqual({
      issuedKinds: 'all',
      receivedKinds: 'none',
    });
  });

  it('maps sales kinds onto the issued table only', () => {
    expect(
      splitLocalExportDocumentTypes(['INVOICE', 'CREDIT_NOTE']),
    ).toEqual({
      issuedKinds: ['INVOICE', 'CREDIT_NOTE'],
      receivedKinds: 'none',
    });
  });

  it('maps purchase kinds onto the received table only', () => {
    expect(
      splitLocalExportDocumentTypes(['PURCHASE_INVOICE', 'PURCHASE_RETURN']),
    ).toEqual({
      issuedKinds: 'none',
      receivedKinds: ['PURCHASE_INVOICE', 'PURCHASE_RETURN'],
    });
  });

  it('maps mixed kinds to both tables (Export All)', () => {
    const all = [...ISSUED_DOCUMENT_TYPES, ...RECEIVED_DOCUMENT_TYPES];
    expect(splitLocalExportDocumentTypes(all)).toEqual({
      issuedKinds: [...ISSUED_DOCUMENT_TYPES],
      receivedKinds: [...RECEIVED_DOCUMENT_TYPES],
    });
  });

  it('ignores unknown type names so they cannot widen the scope', () => {
    expect(splitLocalExportDocumentTypes(['NOT_A_KIND', 'INVOICE'])).toEqual({
      issuedKinds: ['INVOICE'],
      receivedKinds: 'none',
    });
    expect(splitLocalExportDocumentTypes(['NOT_A_KIND'])).toEqual({
      issuedKinds: 'none',
      receivedKinds: 'none',
    });
  });
});
