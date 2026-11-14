/**
 * WCAG 2.1 Color Contrast Utilities and Palette Verification.
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
 * CineBook Design System Palette
 * All color combinations are tuned to meet or exceed WCAG AA requirements:
 * - Normal text: >= 4.5:1
 * - Large text & UI controls: >= 3.0:1
 */
export const PALETTE = {
  // Backgrounds
  bg: '#0b0d16',
  panel: '#141828',
  panel2: '#1b2034',

  // Foreground text (elevated from draft #6d7290 to ensure >= 4.5:1 contrast)
  ink: '#f3f1ea',
  inkSoft: '#aeb3cc',
  inkFaint: '#9298ba', // tuned for > 5.5:1 on #0b0d16 and > 4.5:1 on #1b2034

  // Accents & Interactive Controls
  amber: '#ffb547',
  amberDeep: '#f08c1c',
  amberDarkText: '#1a1205', // high contrast text on amber button/chips (> 10:1)

  // Status & Badges
  mint: '#3ddc97',
  mintBg: '#0f2f24',
  rose: '#ff667d',
  roseBg: '#351620',
  violet: '#8b7bff',
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
    { pair: 'Primary text on main background', foreground: PALETTE.ink, background: PALETTE.bg, type: 'normal' },
    { pair: 'Primary text on panel background', foreground: PALETTE.ink, background: PALETTE.panel, type: 'normal' },
    { pair: 'Primary text on panel2 background', foreground: PALETTE.ink, background: PALETTE.panel2, type: 'normal' },
    { pair: 'Soft text on main background', foreground: PALETTE.inkSoft, background: PALETTE.bg, type: 'normal' },
    { pair: 'Soft text on panel background', foreground: PALETTE.inkSoft, background: PALETTE.panel, type: 'normal' },
    { pair: 'Faint/secondary text on main background', foreground: PALETTE.inkFaint, background: PALETTE.bg, type: 'normal' },
    { pair: 'Faint/secondary text on panel background', foreground: PALETTE.inkFaint, background: PALETTE.panel, type: 'normal' },
    { pair: 'Faint/secondary text on panel2 background', foreground: PALETTE.inkFaint, background: PALETTE.panel2, type: 'normal' },
    { pair: 'Text on primary amber button', foreground: PALETTE.amberDarkText, background: PALETTE.amber, type: 'normal' },
    { pair: 'Paid badge mint text on dark mint bg', foreground: PALETTE.mint, background: PALETTE.mintBg, type: 'normal' },
    { pair: 'Rose alert text on dark rose bg', foreground: PALETTE.rose, background: PALETTE.roseBg, type: 'normal' },
    { pair: 'Active keyboard focus ring on main background', foreground: PALETTE.amber, background: PALETTE.bg, type: 'ui' },
    { pair: 'Active keyboard focus ring on panel background', foreground: PALETTE.amber, background: PALETTE.panel, type: 'ui' },
    { pair: 'Selected seat boundary indicator', foreground: PALETTE.amber, background: PALETTE.panel2, type: 'ui' },
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
