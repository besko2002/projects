import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDITED_PAIRS, PALETTE, auditPaletteContrast, getContrastRatio } from './contrast';

// Vitest stubs CSS imports to an empty module, so the palette contract is checked against the
// real file on disk. The test runs with the storefront directory as its working directory.
const css = readFileSync('src/index.css', 'utf8');

function cssVariable(name: string): string | undefined {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  return match?.[1].toLowerCase();
}

/** The CSS custom property behind each palette entry; both sides must name the same colour. */
const CSS_NAMES: ReadonlyArray<[keyof typeof PALETTE, string]> = [
  ['white', 'white'],
  ['ink', 'ink'],
  ['inkSoft', 'ink-soft'],
  ['line', 'line'],
  ['accent', 'accent'],
  ['accentDark', 'accent-dark'],
  ['accentTint', 'accent-tint'],
  ['surface', 'surface'],
  ['disabledText', 'disabled-text'],
  ['success', 'success'],
  ['successTint', 'success-tint'],
  ['danger', 'danger'],
  ['dangerTint', 'danger-tint'],
  ['warning', 'warning'],
  ['warningTint', 'warning-tint'],
];

describe('design system palette', () => {
  it('keeps index.css and contrast.ts on identical hex values', () => {
    for (const [key, cssName] of CSS_NAMES) {
      expect(cssVariable(cssName), `--${cssName}`).toBe(PALETTE[key]);
    }
  });

  it('computes WCAG contrast ratios', () => {
    expect(getContrastRatio('#000000', '#ffffff')).toBe(21);
    expect(getContrastRatio(PALETTE.ink, PALETTE.white)).toBeGreaterThan(15);
  });

  it('passes every audited text/UI pair at WCAG AA', () => {
    const results = auditPaletteContrast();
    expect(results).toHaveLength(AUDITED_PAIRS.length);
    const failures = results.filter((result) => !result.passes);
    expect(failures).toEqual([]);
  });

  it('labels the audited pairs with their required ratio', () => {
    for (const result of auditPaletteContrast()) {
      expect(result.required).toBe(result.type === 'normal' ? 4.5 : 3);
      expect(result.ratio).toBeGreaterThan(0);
    }
  });
});
