import {
  etaSyncIssuedNeedsBackfill,
  etaSyncIssuedPeriodDiffers,
} from './sales-sync.service';

describe('etaSyncIssuedNeedsBackfill', () => {
  it('rewrites ETA_SYNC drafts even when lines already exist', () => {
    expect(
      etaSyncIssuedNeedsBackfill({
        origin: 'ETA_SYNC',
        status: 'DRAFT',
        taxTotalsJson: [],
        lineCount: 1,
        hasLineTax: false,
      }),
    ).toBe(true);
  });

  it('rewrites VALID ETA_SYNC rows that have lines but no stored taxes', () => {
    expect(
      etaSyncIssuedNeedsBackfill({
        origin: 'ETA_SYNC',
        status: 'VALID',
        taxTotalsJson: [],
        lineCount: 2,
        hasLineTax: false,
      }),
    ).toBe(true);
  });

  it('skips complete VALID ETA_SYNC rows (resume-friendly)', () => {
    expect(
      etaSyncIssuedNeedsBackfill({
        origin: 'ETA_SYNC',
        status: 'VALID',
        taxTotalsJson: [{ taxType: 'T1', amount: '140.00' }],
        lineCount: 1,
        hasLineTax: true,
      }),
    ).toBe(false);
  });

  it('does not treat local drafts as sales-sync backfill targets', () => {
    expect(
      etaSyncIssuedNeedsBackfill({
        origin: 'LOCAL',
        status: 'DRAFT',
        taxTotalsJson: [],
        lineCount: 1,
        hasLineTax: true,
      }),
    ).toBe(false);
  });
});

describe('etaSyncIssuedPeriodDiffers', () => {
  it('is true when stored June disagrees with September search row', () => {
    expect(
      etaSyncIssuedPeriodDiffers(new Date('2026-06-15T10:00:00.000Z'), {
        dateTimeIssued: '2026-09-12T12:00:00.000+03:00',
      }),
    ).toBe(true);
  });

  it('is false when stored and search row share the same UTC month', () => {
    expect(
      etaSyncIssuedPeriodDiffers(new Date('2026-09-12T09:00:00.000Z'), {
        dateTimeIssued: '2026-09-12T12:00:00.000+03:00',
      }),
    ).toBe(false);
  });

  it('is false when the search row has no issue date', () => {
    expect(
      etaSyncIssuedPeriodDiffers(new Date('2026-06-15T10:00:00.000Z'), {
        uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
      }),
    ).toBe(false);
  });
});
