/**
 * WCAG 2.1 contrast utilities and the audited palette of the Outline Store design system.
 * The hex values must stay identical to the custom properties at the top of index.css.
 */

export function parseHex(hex: string): [number, number, number] {
  let cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(cleaned, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  const lum1 = relativeLuminance(r1, g1, b1);
  const lum2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/** Flat outline palette: white, ink outlines, one accent blue, and muted status tints. */
export const PALETTE = {
  white: '#ffffff',
  ink: '#111111',
  inkSoft: '#4a4a4a',
  line: '#111111',
  accent: '#2a4bff',
  accentDark: '#1a35d6',
  accentTint: '#eef1ff',
  surface: '#f5f5f5',
  disabledText: '#6b6b6b',
  success: '#0f6b3a',
  successTint: '#e8f5ee',
  danger: '#b3261e',
  dangerTint: '#fdecea',
  warning: '#7a4b00',
  warningTint: '#fff4de',
} as const;

export type ContrastKind = 'normal' | 'large' | 'ui';

export interface ContrastAuditResult {
  pair: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  type: ContrastKind;
  passes: boolean;
}

export const AUDITED_PAIRS: ReadonlyArray<{
  pair: string;
  foreground: string;
  background: string;
  type: ContrastKind;
}> = [
  { pair: 'Body text on white page', foreground: PALETTE.ink, background: PALETTE.white, type: 'normal' },
  { pair: 'Secondary text on white page', foreground: PALETTE.inkSoft, background: PALETTE.white, type: 'normal' },
  { pair: 'Secondary text on surface panel', foreground: PALETTE.inkSoft, background: PALETTE.surface, type: 'normal' },
  { pair: 'Body text on surface panel', foreground: PALETTE.ink, background: PALETTE.surface, type: 'normal' },
  { pair: 'White text on accent primary button', foreground: PALETTE.white, background: PALETTE.accent, type: 'normal' },
  { pair: 'White text on accent hover/active button', foreground: PALETTE.white, background: PALETTE.accentDark, type: 'normal' },
  { pair: 'Accent link text on white page', foreground: PALETTE.accent, background: PALETTE.white, type: 'normal' },
  { pair: 'Accent text on accent tint (selected/info)', foreground: PALETTE.accentDark, background: PALETTE.accentTint, type: 'normal' },
  { pair: 'Ink text on accent tint (secondary hover)', foreground: PALETTE.ink, background: PALETTE.accentTint, type: 'normal' },
  { pair: 'White text on ink (inverted badge)', foreground: PALETTE.white, background: PALETTE.ink, type: 'normal' },
  { pair: 'Disabled text on surface (disabled control)', foreground: PALETTE.disabledText, background: PALETTE.surface, type: 'normal' },
  { pair: 'Success text on success tint', foreground: PALETTE.success, background: PALETTE.successTint, type: 'normal' },
  { pair: 'Danger text on danger tint', foreground: PALETTE.danger, background: PALETTE.dangerTint, type: 'normal' },
  { pair: 'Warning text on warning tint', foreground: PALETTE.warning, background: PALETTE.warningTint, type: 'normal' },
  { pair: 'Danger text on white page (field errors)', foreground: PALETTE.danger, background: PALETTE.white, type: 'normal' },
  { pair: 'Ink outline on white (control boundary)', foreground: PALETTE.line, background: PALETTE.white, type: 'ui' },
  { pair: 'Accent focus ring on white', foreground: PALETTE.accent, background: PALETTE.white, type: 'ui' },
  { pair: 'Ink focus ring on accent button', foreground: PALETTE.ink, background: PALETTE.accent, type: 'ui' },
  { pair: 'Big headings on white', foreground: PALETTE.ink, background: PALETTE.white, type: 'large' },
];

export function auditPaletteContrast(): ContrastAuditResult[] {
  return AUDITED_PAIRS.map(({ pair, foreground, background, type }) => {
    const ratio = getContrastRatio(foreground, background);
    const required = type === 'normal' ? 4.5 : 3.0;
    return { pair, foreground, background, ratio, required, type, passes: ratio >= required };
  });
}
