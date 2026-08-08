import { add, formatMoney, formatMoneyDisplay, formatQuantityDisplay, mul, sub } from './money.js';

describe('money helpers', () => {
  it('formats with exactly 2 fractional digits', () => {
    expect(formatMoney('10')).toBe('10.00');
    expect(formatMoney('0')).toBe('0.00');
    expect(formatMoney('10.5')).toBe('10.50');
  });

  it('rounds midpoint half away from zero', () => {
    expect(formatMoney('1.225')).toBe('1.23');
    expect(formatMoney('1.235')).toBe('1.24');
    expect(formatMoney('-1.225')).toBe('-1.23');
  });

  it('adds/subtracts/multiplies as money strings', () => {
    expect(add('10.00', '0.50')).toBe('10.50');
    expect(sub('10.00', '0.01')).toBe('9.99');
    expect(mul('5', '2.5')).toBe('12.50');
  });

  it('formatMoneyDisplay groups thousands for UI only', () => {
    expect(formatMoneyDisplay('14520')).toBe('14,520.00');
    expect(formatMoneyDisplay('14520.5')).toBe('14,520.50');
    expect(formatMoneyDisplay('-1234567.8')).toBe('-1,234,567.80');
    expect(formatMoneyDisplay(null)).toBe('—');
    expect(formatMoneyDisplay('')).toBe('—');
    // Canonical path must stay ungrouped
    expect(formatMoney('14520')).toBe('14520.00');
  });

  it('formatQuantityDisplay groups without forcing 2 dp', () => {
    expect(formatQuantityDisplay('1000')).toBe('1,000');
    expect(formatQuantityDisplay('1000.5')).toBe('1,000.5');
    expect(formatQuantityDisplay('14')).toBe('14');
  });
});
