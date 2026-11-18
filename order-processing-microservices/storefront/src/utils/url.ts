/**
 * Accepts only an internal path starting with a single "/" (no "//host" or "/\host"), so a
 * crafted ?return= value cannot become an open redirect.
 */
export function sanitizeReturnPath(path: string | null | undefined): string {
  if (!path) return '/';
  const hasControlChar = [...path].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  if (/^\/(?![/\\])/.test(path) && !hasControlChar) {
    return path;
  }
  return '/';
}

export function signInPath(returnPath: string): string {
  const safe = sanitizeReturnPath(returnPath);
  return safe === '/' ? '/signin' : `/signin?return=${encodeURIComponent(safe)}`;
}

/**
 * The payment URL comes from our own backend, but it is still only followed when it is a
 * trusted absolute URL — a `javascript:` or `data:` value must never reach `location.assign`.
 *
 * Stripe Checkout is HTTPS, hosted on `checkout.stripe.com`. Plain HTTP is tolerated only for a
 * loopback host, which keeps local development stacks usable without ever sending a checkout
 * session over the network in clear.
 */
export function isSafePaymentUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      // Only Stripe's official checkout domain is trusted over HTTPS.
      return parsed.hostname === 'checkout.stripe.com';
    }
    if (parsed.protocol === 'http:') {
      return (
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]'
      );
    }
    return false;
  } catch {
    return false;
  }
}

/** Indirection so tests can observe redirects without jsdom navigation. */
export const browser = {
  redirect(url: string): void {
    window.location.assign(url);
  },
};
