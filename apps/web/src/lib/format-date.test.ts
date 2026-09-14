import {
  formatCairoDateDisplay,
  formatCairoTimeDisplay,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatEtaDate,
  formatEtaDateTime,
} from './format-date';

const noonUtc = '2026-09-01T12:00:00.000Z';

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

  it('formats Cairo date and time separately from the ISO instant', () => {
    const date = formatCairoDateDisplay(noonUtc, 'en');
    expect(date).toBe(
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Cairo',
      }).format(new Date(noonUtc)),
    );

    const time = formatCairoTimeDisplay(noonUtc, 'en');
    expect(time).toBe(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Africa/Cairo',
      }).format(new Date(noonUtc)),
    );
    expect(time).not.toContain('T');
    expect(time).not.toContain('Z');
  });

  it('does not force Cairo on generic display helpers', () => {
    const when = formatDateTimeDisplay(noonUtc, 'en');
    const cairoForced = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo',
    }).format(new Date(noonUtc));
    const runtimeLocal = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(noonUtc));
    expect(when).toBe(runtimeLocal);
    if (runtimeLocal !== cairoForced) {
      expect(when).not.toBe(cairoForced);
    }
  });
});
