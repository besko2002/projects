/**
 * Poster rendering helpers.
 * If posterUrl is present, render image; otherwise render approved gradient artwork.
 */

export const POSTER_GRADIENTS = [
  'radial-gradient(circle at 30% 30%, #ff9a5a, transparent 45%), linear-gradient(160deg, #3b1d5e, #c2410c)',
  'radial-gradient(circle at 70% 25%, #7dd3fc, transparent 40%), linear-gradient(160deg, #0f2a4a, #155e75)',
  'radial-gradient(circle at 50% 35%, #fde68a, transparent 35%), linear-gradient(160deg, #1f2937, #7c2d12)',
  'radial-gradient(circle at 25% 70%, #f0abfc, transparent 40%), linear-gradient(160deg, #2e1065, #be185d)',
  'radial-gradient(circle at 75% 60%, #86efac, transparent 40%), linear-gradient(160deg, #052e16, #166534)',
  'radial-gradient(circle at 40% 30%, #c4b5fd, transparent 40%), linear-gradient(160deg, #111827, #4338ca)',
];

export function getPosterGradient(seed: string | number): string {
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % POSTER_GRADIENTS.length;
  return POSTER_GRADIENTS[index];
}
