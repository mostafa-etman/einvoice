import { etaSyncIssuedNeedsBackfill } from './sales-sync.service';

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
