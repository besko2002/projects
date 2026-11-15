/**
 * WCAG 2.1 Color Contrast Utilities and Palette Verification.
 * CineBook Retro Cinema Design System
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

/**
 * CineBook Retro Cinema Palette
 * All color combinations meet or exceed WCAG AA requirements:
 * - Normal text: >= 4.5:1
 * - Large display text & UI controls: >= 3.0:1
 */
export const PALETTE = {
  cream: '#f3ead7',
  paper: '#fffaf0',
  ink: '#221a14',
  inkSoft: '#5e4d3e',
  red: '#b5302b',
  redDeep: '#8f221e',
  teal: '#1f6f6b',
  mustard: '#e2a73a',
  sand: '#c9b99a',
  bulb: '#ffd56b',
} as const;

export interface ContrastAuditResult {
  pair: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  type: 'normal' | 'large' | 'ui';
  passes: boolean;
}

export function auditPaletteContrast(): ContrastAuditResult[] {
  const pairs: Array<{
    pair: string;
    foreground: string;
    background: string;
    type: 'normal' | 'large' | 'ui';
  }> = [
    { pair: 'Ink primary text on cream page background', foreground: PALETTE.ink, background: PALETTE.cream, type: 'normal' },
    { pair: 'Ink primary text on paper card background', foreground: PALETTE.ink, background: PALETTE.paper, type: 'normal' },
    { pair: 'Ink-soft subdued text on cream page background', foreground: PALETTE.inkSoft, background: PALETTE.cream, type: 'normal' },
    { pair: 'Ink-soft subdued text on paper card background', foreground: PALETTE.inkSoft, background: PALETTE.paper, type: 'normal' },
    { pair: 'Paper text on red primary button', foreground: PALETTE.paper, background: PALETTE.red, type: 'normal' },
    { pair: 'Paper text on teal active day / selected seat', foreground: PALETTE.paper, background: PALETTE.teal, type: 'normal' },
    { pair: 'Paper text on dark ink tile / summary header', foreground: PALETTE.paper, background: PALETTE.ink, type: 'normal' },
    { pair: 'Bulb sign text on red marquee header', foreground: PALETTE.bulb, background: PALETTE.red, type: 'large' },
    { pair: 'Bulb title accent on dark ink summary header', foreground: PALETTE.bulb, background: PALETTE.ink, type: 'normal' },
    { pair: 'Ink text/icon on mustard VIP seat', foreground: PALETTE.ink, background: PALETTE.mustard, type: 'normal' },
    { pair: 'Ink text on bulb countdown clock', foreground: PALETTE.ink, background: PALETTE.bulb, type: 'normal' },
    { pair: 'Red kicker/link text on paper card', foreground: PALETTE.red, background: PALETTE.paper, type: 'normal' },
    { pair: 'Red kicker headline on cream background', foreground: PALETTE.red, background: PALETTE.cream, type: 'normal' },
    { pair: 'Ink keyboard focus indicator on cream background', foreground: PALETTE.ink, background: PALETTE.cream, type: 'ui' },
    { pair: 'Bulb keyboard focus indicator on red marquee', foreground: PALETTE.bulb, background: PALETTE.red, type: 'ui' },
  ];

  return pairs.map(({ pair, foreground, background, type }) => {
    const ratio = getContrastRatio(foreground, background);
    const required = type === 'normal' ? 4.5 : 3.0;
    return {
      pair,
      foreground,
      background,
      ratio,
      required,
      type,
      passes: ratio >= required,
    };
  });
}
