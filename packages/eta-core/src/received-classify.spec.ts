import {
  ETA_DOCUMENT_DIRECTION_RECEIVED,
  assertReceivedDirection,
  classifyReceivedDocument,
  receivedDirectionQuery,
} from './received-classify.js';

describe('received-classify', () => {
  it('uses Received (PascalCase) as the canonical ETA direction', () => {
    expect(ETA_DOCUMENT_DIRECTION_RECEIVED).toBe('Received');
  });

  it('classifies Invoice I as purchase invoice and Credit Note C as purchase return', () => {
    expect(classifyReceivedDocument('I')).toBe('PURCHASE_INVOICE');
    expect(classifyReceivedDocument('i')).toBe('PURCHASE_INVOICE');
    expect(classifyReceivedDocument('C')).toBe('PURCHASE_RETURN');
    expect(classifyReceivedDocument('c')).toBe('PURCHASE_RETURN');
  });

  it('classifies debit and export types as OTHER_RECEIVED', () => {
    expect(classifyReceivedDocument('D')).toBe('OTHER_RECEIVED');
    expect(classifyReceivedDocument('EI')).toBe('OTHER_RECEIVED');
    expect(classifyReceivedDocument('EC')).toBe('OTHER_RECEIVED');
    expect(classifyReceivedDocument('ED')).toBe('OTHER_RECEIVED');
    expect(classifyReceivedDocument('UNKNOWN')).toBe('OTHER_RECEIVED');
    expect(classifyReceivedDocument('')).toBe('OTHER_RECEIVED');
    expect(classifyReceivedDocument(null)).toBe('OTHER_RECEIVED');
  });

  it('receivedDirectionQuery always sets direction=Received and ignores overrides', () => {
    const q = receivedDirectionQuery({
      direction: 'Issued' as unknown as string,
      pageSize: 50,
      status: 'Valid',
    });
    expect(q.direction).toBe('Received');
    expect(q.pageSize).toBe('50');
    expect(q.status).toBe('Valid');
    assertReceivedDirection(q);
  });

  it('assertReceivedDirection rejects Issued or missing direction', () => {
    expect(() => assertReceivedDirection({ direction: 'Issued' })).toThrow(
      /direction=Received/,
    );
    expect(() => assertReceivedDirection({})).toThrow(/direction=Received/);
  });
});
