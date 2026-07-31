import {
  ETA_DATETIME_ISSUED_PATTERN,
  formatEtaDateTimeIssued,
  isValidEtaDateTimeIssued,
  toEtaDecimalNumber,
} from './eta-formats.js';

describe('eta-formats', () => {
  it('strips milliseconds from dateTimeIssued', () => {
    expect(formatEtaDateTimeIssued('2026-07-31T09:16:00.000Z')).toBe(
      '2026-07-31T09:16:00Z',
    );
    expect(formatEtaDateTimeIssued(new Date('2015-02-13T13:15:00.000Z'))).toBe(
      '2015-02-13T13:15:00Z',
    );
  });

  it('validates ETA dateTimeIssued pattern', () => {
    expect(isValidEtaDateTimeIssued('2015-02-13T13:15:00Z')).toBe(true);
    expect(isValidEtaDateTimeIssued('2026-07-31T09:16:00.000Z')).toBe(false);
    expect(ETA_DATETIME_ISSUED_PATTERN.test('2020-10-27T23:59:59Z')).toBe(true);
  });

  it('converts decimal strings to JSON numbers', () => {
    expect(toEtaDecimalNumber('114.00')).toBe(114);
    expect(toEtaDecimalNumber('14.00')).toBe(14);
    expect(toEtaDecimalNumber(1)).toBe(1);
  });
});
