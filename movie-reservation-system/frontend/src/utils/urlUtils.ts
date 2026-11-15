/**
 * URL validation and sanitization utilities.
 */

/**
 * Validates return paths to allow only relative internal paths starting with a single '/'
 * and prevents open redirect attacks (e.g. '//evil.com' or '\evil.com').
 */
export function sanitizeReturnUrl(url: string | null | undefined): string {
  if (!url) return '/';
  if (/^\/(?![/\\])/.test(url)) {
    return url;
  }
  return '/';
}
