import { describe, expect, it } from 'vitest';
import { formatCents, formatMoney, toAmount, toCents } from './money';

describe('money', () => {
  it('parses numbers and numeric strings, and treats garbage as zero', () => {
    expect(toAmount(19.99)).toBe(19.99);
    expect(toAmount('19.99')).toBe(19.99);
    expect(toAmount(null)).toBe(0);
    expect(toAmount(undefined)).toBe(0);
    expect(toAmount('not a number')).toBe(0);
  });

  it('converts to integer cents without binary floating point drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('0.2')).toBe(20);
    expect(toCents('24.50')).toBe(2450);
  });

  it('does cart arithmetic exactly in cents', () => {
    // 0.1 + 0.2 in binary floating point is 0.30000000000000004; in cents it is 30.
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
    expect(toCents(0.1) * 3 + toCents(0.2) * 2).toBe(70);
  });

  it('formats EUR amounts for display', () => {
    expect(formatCents(1999)).toContain('19.99');
    expect(formatCents(0)).toContain('0.00');
    expect(formatMoney('5')).toContain('5.00');
    expect(formatMoney(49, 'EUR')).toContain('49.00');
  });
});
