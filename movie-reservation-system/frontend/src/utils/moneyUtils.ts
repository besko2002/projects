/**
 * Currency formatting utility using Intl.NumberFormat and ticket currency.
 */
export function formatMoney(amount: number | string | null | undefined, currency = 'USD'): string {
  const numeric = Number(amount ?? 0);
  const safeCurrency = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0);
  } catch {
    return `$${numeric.toFixed(2)}`;
  }
}
