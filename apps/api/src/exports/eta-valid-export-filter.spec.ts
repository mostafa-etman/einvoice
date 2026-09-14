import {
  issuedStatusWhere,
  receivedStatusWhere,
  wantsValidEtaExport,
} from './eta-valid-export-filter';

describe('eta valid export filter', () => {
  it('treats only the single VALID status as the Valid ETA invoices filter', () => {
    expect(wantsValidEtaExport(['VALID'])).toBe(true);
    expect(wantsValidEtaExport(['valid'])).toBe(true);
    expect(wantsValidEtaExport(undefined)).toBe(false);
    expect(wantsValidEtaExport(['SUBMITTED'])).toBe(false);
    expect(wantsValidEtaExport(['VALID', 'SUBMITTED'])).toBe(false);
  });

  it('matches local VALID or ETA_SYNC Valid and excludes cancelled/invalid/rejected', () => {
    expect(issuedStatusWhere(['VALID'])).toEqual({
      AND: [
        {
          OR: [
            { status: 'VALID' },
            {
              origin: 'ETA_SYNC',
              etaStatus: { equals: 'Valid', mode: 'insensitive' },
            },
          ],
        },
        { status: { notIn: ['INVALID', 'REJECTED', 'CANCELLED'] } },
      ],
    });
    expect(receivedStatusWhere(['VALID'])).toEqual({
      AND: [
        { etaStatus: { equals: 'Valid', mode: 'insensitive' } },
        { buyerDecision: { not: 'REJECTED' } },
      ],
    });
  });

  it('keeps exact local status matching for any other status list', () => {
    expect(issuedStatusWhere(['SUBMITTED'])).toEqual({
      status: { in: ['SUBMITTED'] },
    });
    expect(receivedStatusWhere(['SUBMITTED'])).toBeUndefined();
    expect(issuedStatusWhere(undefined)).toBeUndefined();
    expect(receivedStatusWhere(undefined)).toBeUndefined();
  });
});
