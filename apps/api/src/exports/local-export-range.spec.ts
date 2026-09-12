import {
  cairoDayEnd,
  cairoDayStart,
  localExportIssueRange,
  parseLocalExportInstant,
} from './local-export-range';

describe('localExportIssueRange', () => {
  it('returns undefined when both bounds are omitted', () => {
    expect(localExportIssueRange()).toBeUndefined();
    expect(localExportIssueRange('', '')).toBeUndefined();
  });

  it('treats YYYY-MM-DD as inclusive Cairo calendar days', () => {
    expect(parseLocalExportInstant('2026-09-01', 'from')).toEqual(
      cairoDayStart('2026-09-01'),
    );
    expect(parseLocalExportInstant('2026-09-01', 'to')).toEqual(
      cairoDayEnd('2026-09-01'),
    );
    const range = localExportIssueRange('2026-09-01', '2026-09-01');
    expect(range?.gte?.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2026-09-01T21:59:59.999Z');
  });

  it('treats UTC-midnight ISO (date input toISOString) as Cairo day start', () => {
    const from = parseLocalExportInstant('2026-09-01T00:00:00.000Z', 'from');
    expect(from).toEqual(cairoDayStart('2026-09-01'));
  });

  it('keeps explicit offset timestamps as-is', () => {
    const from = parseLocalExportInstant('2026-09-01T00:00:00.000+02:00', 'from');
    const to = parseLocalExportInstant('2026-09-01T23:59:59.999+02:00', 'to');
    expect(from?.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(to?.toISOString()).toBe('2026-09-01T21:59:59.999Z');
  });
});
