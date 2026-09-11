import { formatCompact, formatMoneyDisplay, formatPercent, formatQuantityDisplay } from './format-number';

describe('format-number', () => {
  it('keeps existing money and quantity semantics', () => {
    expect(formatMoneyDisplay('14520')).toBe('14,520.00');
    expect(formatQuantityDisplay('1000')).toBe('1,000');
  });

  it('formats percent from a ratio with Latin digits', () => {
    expect(formatPercent(0.124)).toBe('12.4%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats compact numbers with Latin digits', () => {
    expect(formatCompact(1284)).toBe('1.3K');
    expect(formatCompact('')).toBe('—');
  });
});
