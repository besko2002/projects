import { describe, it, expect } from 'vitest';
import { auditPaletteContrast } from '../utils/contrast';

describe('WCAG AA Color Contrast Audit', () => {
  it('all design system palette combinations must meet WCAG AA requirements', () => {
    const results = auditPaletteContrast();

    // Ensure all pairs pass
    for (const res of results) {
      expect(
        res.passes,
        `Contrast check failed for "${res.pair}" (${res.foreground} on ${res.background}): ratio ${res.ratio} < ${res.required}`,
      ).toBe(true);
    }

    // Verify there are at least 10 audited pairs
    expect(results.length).toBeGreaterThanOrEqual(10);
  });
});
