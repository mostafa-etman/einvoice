import { cairoExportRangeIso } from './export-date-range';

describe('cairoExportRangeIso', () => {
  it('emits Cairo-inclusive from/to timestamps', () => {
    expect(cairoExportRangeIso('2026-01-01', false)).toBe(
      '2026-01-01T00:00:00.000+02:00',
    );
    expect(cairoExportRangeIso('2026-01-31', true)).toBe(
      '2026-01-31T23:59:59.999+02:00',
    );
  });
});
