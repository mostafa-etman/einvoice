import { formatDateDisplay, formatEtaDate, formatEtaDateTime } from './format-date';

describe('format-date', () => {
  it('uses locale-aware display dates', () => {
    const text = formatDateDisplay('2026-09-01T00:00:00Z', 'en');
    expect(text).toMatch(/2026/);
    expect(text).not.toBe('—');
  });

  it('keeps ETA dates in Latin digits', () => {
    expect(formatEtaDate('2026-09-01T12:00:00Z')).toBe('2026-09-01');
    expect(formatEtaDateTime('2026-09-01T12:00:00Z')).toMatch(/2026/);
  });
});
