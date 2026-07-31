import { mapEtaReceivedRow } from './received-document.mapper';

describe('received-document upsert mapping', () => {
  it('skips store when uuid missing (documentUuid null)', () => {
    const mapped = mapEtaReceivedRow({
      documentType: 'I',
      issuerName: 'Acme',
      status: 'Valid',
    });
    expect(mapped.documentUuid).toBeNull();
    expect(mapped.kind).toBe('PURCHASE_INVOICE');
  });

  it('classifies I and C and keeps uuid for upsert key', () => {
    expect(
      mapEtaReceivedRow({ uuid: 'u-1', documentType: 'I' }).kind,
    ).toBe('PURCHASE_INVOICE');
    expect(
      mapEtaReceivedRow({ uuid: 'u-2', documentType: 'C' }).kind,
    ).toBe('PURCHASE_RETURN');
    expect(mapEtaReceivedRow({ uuid: 'u-1', documentType: 'I' }).documentUuid).toBe(
      'u-1',
    );
  });
});
