import type { Money } from '../types/api';

/**
 * The catalog has no currency field; order-service prices every order in its DEFAULT_CURRENCY,
 * which is EUR. Catalog prices and cart estimates are therefore shown in EUR, and orders use the
 * currency they carry.
 */
export const CATALOG_CURRENCY = 'EUR';

/** Parses a BigDecimal coming from the API (number or numeric string) into a finite number. */
export function toAmount(value: Money | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Integer cents; cart math is done in cents to avoid binary floating point drift. */
export function toCents(value: Money | null | undefined): number {
  return Math.round(toAmount(value) * 100);
}

export function formatMoney(value: Money | null | undefined, currency: string = CATALOG_CURRENCY): string {
  const amount = toAmount(value);
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatCents(cents: number, currency: string = CATALOG_CURRENCY): string {
  return formatMoney(cents / 100, currency);
}
