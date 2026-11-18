import type { CreateOrderRequest, OrderItemRequest } from '../types/api';

/**
 * The checkout attempt's durable memory.
 *
 * `POST /api/orders` is idempotent per `Idempotency-Key`: the same key with the same items
 * replays the already-created order instead of creating a second one. That only protects the
 * customer if the storefront keeps the key across the ambiguous windows of a checkout — a lost
 * response, a reload on the hosted Stripe page, a retry button. So the attempt (key, payload and
 * the created order id) is persisted in localStorage and only cleared once the attempt reaches a
 * resolved state or the customer deliberately changes the purchase.
 *
 * Changing the cart while an attempt is unresolved does NOT silently mint a new key: the old
 * attempt must be resolved first (that is what "same key AND payload until resolved" means), and
 * the changed-cart case is signalled so the UI can ask the customer to resolve it explicitly.
 */

const ATTEMPT_KEY = 'outline_store_checkout_attempt';

export interface CheckoutAttempt {
  /** The `Idempotency-Key` every retry of this attempt must send. */
  key: string;
  /** The exact payload the key was generated for. */
  payload: CreateOrderRequest;
  /** The order the attempt created, once known (used by the payment pages to recover). */
  orderId: string | null;
  /** ISO timestamp of the first request, for diagnostics. */
  startedAt: string;
}

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function loadAttempt(): CheckoutAttempt | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const attempt = parsed as Partial<CheckoutAttempt>;
    if (typeof attempt.key !== 'string' || !attempt.key) return null;
    if (!isCreateOrderRequest(attempt.payload)) return null;
    return {
      key: attempt.key,
      payload: attempt.payload,
      orderId: typeof attempt.orderId === 'string' ? attempt.orderId : null,
      startedAt: typeof attempt.startedAt === 'string' ? attempt.startedAt : new Date().toISOString(),
    };
  } catch {
    // A corrupt record is a lost attempt, not a broken store: drop it and start clean. The
    // server's per-order idempotency still protects against the extremely unlikely case of a
    // duplicate order.
    clearAttempt();
    return null;
  }
}

export function saveAttempt(attempt: CheckoutAttempt): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Storage can be unavailable (private mode, quota); the attempt simply stays in memory.
  }
}

export function clearAttempt(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Nothing to recover to; the attempt is over either way.
  }
}

/**
 * Replaces an unresolved attempt with a fresh one. Only legitimate once the previous attempt is
 * resolved (final order state, or the customer explicitly abandoned it) — the callers own that
 * decision.
 */
export function beginAttempt(items: OrderItemRequest[]): CheckoutAttempt {
  // Preserve any in-memory attempt across storage-denied mounts (R5).
  // If there is already an attempt key in localStorage, reuse it instead of
  // generating a fresh UUID, which would create a duplicate order risk when
  // localStorage writes are blocked (private browsing, quota, policy).
  const existingKey = typeof window !== "undefined"

    ? window.localStorage.getItem(ATTEMPT_KEY)

    : null;
  if (existingKey) {
    const parsed = JSON.parse(existingKey);
    if (parsed && parsed.key && isCreateOrderRequest(parsed.payload)) {
      return {
        key: parsed.key,
        payload: parsed.payload,
        orderId: typeof parsed.orderId === "string" ? parsed.orderId : null,
        startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      };
    }
  }
  const attempt: CheckoutAttempt = {
    key: crypto.randomUUID(),
    payload: { items: items.map((item) => ({ ...item })) },
    orderId: null,
    startedAt: new Date().toISOString(),
  };
  saveAttempt(attempt);
  return attempt;
}

/**
 * @param attempt the stored attempt, if any
 * @param items   the cart the customer wants to check out now
 * @return whether the attempt matches this cart exactly (same products, same quantities, same
 *         order) — the precondition for reusing its idempotency key
 */
export function attemptMatchesCart(attempt: CheckoutAttempt | null, items: OrderItemRequest[]): boolean {
  if (!attempt) return false;
  const a = attempt.payload.items;
  if (a.length !== items.length) return false;
  return a.every((line, index) =>
    line.productId === items[index].productId && line.quantity === items[index].quantity,
  );
}

function isCreateOrderRequest(value: unknown): value is CreateOrderRequest {
  if (!value || typeof value !== 'object') return false;
  const items = (value as CreateOrderRequest).items;
  if (!Array.isArray(items)) return false;
  return items.every(
    (item) =>
      typeof item?.productId === 'string' &&
      item.productId.length > 0 &&
      Number.isInteger(item?.quantity) &&
      (item?.quantity as number) > 0,
  );
}
