import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { createOrder, getOrder } from '../api/ordersApi';
import { EmptyState, Loading } from '../components/Feedback';
import { OrderStatusBadge } from '../components/StatusBadge';
import {
  attemptMatchesCart,
  beginAttempt,
  clearAttempt,
  loadAttempt,
  saveAttempt,
  type CheckoutAttempt,
} from '../lib/idempotency';
import { pollUntil } from '../lib/poll';
import { useCart } from '../state/cart';
import type { OrderItemRequest, OrderResponse } from '../types/api';
import { browser, isSafePaymentUrl } from '../utils/url';
import { formatMoney } from '../utils/money';

type Phase =
  | 'preparing'
  | 'awaiting'
  | 'redirecting'
  | 'confirmed'
  | 'failed'
  | 'timeout'
  | 'choose'
  | 'unsafe'
  | 'empty'
  | 'error';

interface FlowHandlers {
  onAttempt(attempt: CheckoutAttempt): void;
  onOrder(order: OrderResponse): void;
  onPhase(phase: Phase): void;
  /** A definitive refusal from the server; the attempt has been cleared. */
  onFailure(message: string): void;
  /** A recoverable problem; the attempt is preserved so retrying reuses the same key. */
  onRetryableError(message: string): void;
  /** A final order state (CONFIRMED, CANCELLED or REJECTED); the attempt has been cleared. */
  onResolved(order: OrderResponse): void;
  /** The stored order id cannot be read back (e.g. it belongs to another account). */
  onUnrecoverable(message: string): void;
  onUnsafeUrl(): void;
}

function isResolved(order: OrderResponse): boolean {
  return order.status === 'CONFIRMED' || order.status === 'CANCELLED' || order.status === 'REJECTED';
}

function isDone(order: OrderResponse): boolean {
  return isResolved(order) || Boolean(order.paymentUrl);
}

function isRetryable(error: unknown): boolean {
  return error instanceof ApiException && error.retryable;
}

/** Decides what a decisive order response means for the page. */
function conclude(order: OrderResponse, handlers: FlowHandlers): void {
  handlers.onOrder(order);
  if (isResolved(order)) {
    clearAttempt();
    handlers.onResolved(order);
    return;
  }
  if (order.paymentUrl) {
    if (isSafePaymentUrl(order.paymentUrl)) {
      handlers.onPhase('redirecting');
      browser.redirect(order.paymentUrl);
      return;
    }
    handlers.onUnsafeUrl();
    return;
  }
  handlers.onPhase('timeout');
}

async function watchOrder(
  orderId: string,
  signal: { cancelled: boolean },
  handlers: FlowHandlers,
): Promise<void> {
  try {
    const result = await pollUntil<OrderResponse>({
      load: () => getOrder(orderId),
      isDone,
      signal,
      onValue: handlers.onOrder,
      retryable: isRetryable,
    });
    if (result.status === 'cancelled') return;
    if (result.status === 'timeout') {
      handlers.onPhase('timeout');
      return;
    }
    conclude(result.value as OrderResponse, handlers);
  } catch (err) {
    if (signal.cancelled) return;
    if (err instanceof ApiException && err.status === 404) {
      clearAttempt();
      handlers.onUnrecoverable(errorMessage(err));
      return;
    }
    handlers.onRetryableError(errorMessage(err));
  }
}

/**
 * Places (or, when the same attempt is replayed, re-announces) the order and follows it until the
 * checkout link arrives or the order reaches a final state. The attempt — key and payload — is
 * persisted before the first request and only cleared once the outcome is known, which is what
 * makes a lost response, a reload or a retry harmless.
 */
async function runCheckout(
  items: OrderItemRequest[],
  existing: CheckoutAttempt | null,
  signal: { cancelled: boolean },
  handlers: FlowHandlers,
): Promise<void> {
  const attempt = existing ?? beginAttempt(items);
  handlers.onAttempt(attempt);
  handlers.onPhase('preparing');

  let created: OrderResponse;
  try {
    created = await createOrder(attempt.payload, attempt.key);
  } catch (err) {
    if (signal.cancelled) return;
    if (isRetryable(err)) {
      // Ambiguous: the order may exist even though the answer was lost. The attempt stays
      // persisted, so Retry resends the same key and payload instead of creating a second order.
      handlers.onRetryableError(errorMessage(err));
      return;
    }
    clearAttempt();
    handlers.onFailure(errorMessage(err));
    return;
  }

  if (signal.cancelled) return;
  const tracked: CheckoutAttempt = { ...attempt, orderId: created.id };
  saveAttempt(tracked);
  handlers.onAttempt(tracked);
  handlers.onOrder(created);

  if (isDone(created)) {
    conclude(created, handlers);
    return;
  }

  handlers.onPhase('awaiting');
  try {
    const result = await pollUntil<OrderResponse>({
      load: () => getOrder(created.id),
      isDone,
      signal,
      onValue: handlers.onOrder,
      retryable: isRetryable,
    });
    if (result.status === 'cancelled') return;
    if (result.status === 'timeout') {
      handlers.onPhase('timeout');
      return;
    }
    conclude(result.value as OrderResponse, handlers);
  } catch (err) {
    if (signal.cancelled) return;
    if (err instanceof ApiException && err.status === 404) {
      handlers.onUnrecoverable(errorMessage(err));
      return;
    }
    handlers.onRetryableError(errorMessage(err));
  }
}

export function CheckoutPage() {
  const { lines, clearCart } = useCart();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [attemptState, setAttemptState] = useState<CheckoutAttempt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [chooseReason, setChooseReason] = useState<'different-cart' | 'empty-cart'>('different-cart');
  const [canDiscard, setCanDiscard] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [forcedAttempt, setForcedAttempt] = useState<CheckoutAttempt | null>(null);

  // Sorted so the same purchase always produces the same payload, whatever order the cart was
  // filled in: the idempotency key and its payload must stay byte-for-byte consistent.
  const cartItems = useMemo<OrderItemRequest[]>(
    () =>
      lines
        .map((line) => ({ productId: line.productId, quantity: line.quantity }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
    [lines],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    const handlers: FlowHandlers = {
      onAttempt: (attempt) => setAttemptState(attempt),
      onOrder: (next) => setOrder(next),
      onPhase: (next) => setPhase(next),
      onFailure: (failureMessage) => {
        setMessage(failureMessage);
        setPhase('failed');
      },
      onRetryableError: (failureMessage) => {
        setMessage(failureMessage);
        setPhase('error');
      },
      onResolved: (finalOrder) => {
        setOrder(finalOrder);
        if (finalOrder.status === 'CONFIRMED') {
          clearCart();
          setPhase('confirmed');
        } else {
          setMessage(finalOrder.failureReason ?? null);
          setPhase('failed');
        }
      },
      onUnrecoverable: (failureMessage) => {
        setCanDiscard(true);
        setMessage(failureMessage);
        setPhase('error');
      },
      onUnsafeUrl: () => setPhase('unsafe'),
    };

    if (forcedAttempt) {
      void runCheckout(cartItems, forcedAttempt, signal, handlers);
      return () => {
        signal.cancelled = true;
      };
    }

    const stored = loadAttempt();
    if (stored?.orderId) {
      setAttemptState(stored);
      setPhase('awaiting');
      void watchOrder(stored.orderId, signal, handlers);
      return () => {
        signal.cancelled = true;
      };
    }
    if (cartItems.length === 0) {
      if (stored) {
        setAttemptState(stored);
        setChooseReason('empty-cart');
        setPhase('choose');
      } else {
        setPhase('empty');
      }
      return () => {
        signal.cancelled = true;
      };
    }
    if (stored && !attemptMatchesCart(stored, cartItems)) {
      setAttemptState(stored);
      setChooseReason('different-cart');
      setPhase('choose');
      return () => {
        signal.cancelled = true;
      };
    }
    void runCheckout(cartItems, stored, signal, handlers);
    return () => {
      signal.cancelled = true;
    };
  }, [runKey, forcedAttempt, cartItems, clearCart]);

  const retry = () => {
    setForcedAttempt(null);
    setMessage(null);
    setCanDiscard(false);
    setRunKey((key) => key + 1);
  };

  const resume = () => {
    if (attemptState) {
      setMessage(null);
      setForcedAttempt(attemptState);
      setRunKey((key) => key + 1);
    }
  };

  const discardAndReturn = () => {
    clearAttempt();
    setAttemptState(null);
    setForcedAttempt(null);
  };

  if (phase === 'empty') {
    return (
      <>
        <div className="page-header">
          <h1>Checkout</h1>
        </div>
        <EmptyState title="There is nothing to check out.">
          <p className="muted">Add products to your cart first.</p>
          <p>
            <Link className="btn btn--primary" to="/">
              Browse the catalog
            </Link>
          </p>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Checkout</h1>
        <p className="page-lede">
          Your order is placed with an idempotency key, so retries and reloads can never create a
          second order for the same purchase.
        </p>
      </div>

      <div className="stack" aria-live="polite">
        {phase === 'preparing' && <Loading label="Placing your order…" />}

        {phase === 'awaiting' && (
          <div className="form-panel">
            <Loading label="Waiting for the payment link…" />
            {order && (
              <p>
                Order <strong className="mono">{order.orderNumber}</strong>{' '}
                <OrderStatusBadge status={order.status} />
              </p>
            )}
            <p className="muted">
              The saga is reserving stock and opening a Stripe Checkout session. This page keeps
              checking the order; you can also leave and return to it later.
            </p>
          </div>
        )}

        {phase === 'redirecting' && (
          <div className="alert alert--info" role="status">
            <div>
              <strong>Redirecting to Stripe Checkout…</strong>
              {order?.paymentUrl && isSafePaymentUrl(order.paymentUrl) && (
                <p>
                  If nothing happens, <a href={order.paymentUrl}>continue to the payment page</a>.
                </p>
              )}
            </div>
          </div>
        )}

        {phase === 'confirmed' && order && (
          <div className="alert alert--success" role="status">
            <div>
              <strong>Order confirmed</strong>
              <p>
                Order <span className="mono">{order.orderNumber}</span> for{' '}
                {formatMoney(order.totalAmount, order.currency)} is paid and confirmed.
              </p>
              <p>
                <Link className="btn btn--small" to={`/orders/${order.id}`}>
                  View order
                </Link>
              </p>
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="alert alert--error" role="alert">
            <div>
              <strong>The order could not be completed</strong>
              <p>{message ?? order?.failureReason ?? 'The order was cancelled.'}</p>
              {order && <OrderStatusBadge status={order.status} />}
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
                {order && (
                  <Link className="btn btn--small" to={`/orders/${order.id}`}>
                    View order
                  </Link>
                )}
                {cartItems.length > 0 && (
                  <Link className="btn btn--small" to="/cart">
                    Back to cart
                  </Link>
                )}
              </p>
            </div>
          </div>
        )}

        {phase === 'timeout' && (
          <div className="alert alert--warning" role="status">
            <div>
              <strong>This is taking longer than usual</strong>
              <p>
                The order is still being processed on the server. Nothing is lost — retry the check
                or open the order to see its current status.
              </p>
              {order && (
                <p>
                  Order <span className="mono">{order.orderNumber}</span>{' '}
                  <OrderStatusBadge status={order.status} />
                </p>
              )}
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
                <button type="button" className="btn btn--small" onClick={retry}>
                  Check again
                </button>
                {order && (
                  <Link className="btn btn--small" to={`/orders/${order.id}`}>
                    View order
                  </Link>
                )}
                <Link className="btn btn--small" to="/cart">
                  Back to cart
                </Link>
              </p>
            </div>
          </div>
        )}

        {phase === 'choose' && attemptState && (
          <div className="form-panel stack">
            <h2>An unfinished checkout is stored</h2>
            <p>
              {chooseReason === 'empty-cart'
                ? 'Your cart is empty, but a checkout attempt that may have reached the server is still stored. Resolve it before starting another purchase.'
                : 'You have an unfinished checkout for a different cart. To avoid charging the wrong purchase, continue that attempt first — its key and payload must be reused until it is resolved.'}
            </p>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={resume}>
                Resume unfinished checkout
              </button>
              {attemptState.orderId && (
                <Link className="btn" to={`/orders/${attemptState.orderId}`}>
                  View that order
                </Link>
              )}
              <Link className="btn" to="/cart">
                Back to cart
              </Link>
            </div>
            <p className="muted">
              Started {new Date(attemptState.startedAt).toLocaleString()} with{' '}
              {attemptState.payload.items.length}{' '}
              {attemptState.payload.items.length === 1 ? 'line' : 'lines'}.
            </p>
          </div>
        )}

        {phase === 'unsafe' && (
          <div className="alert alert--error" role="alert">
            <div>
              <strong>The payment link was not trusted</strong>
              <p>
                The store received a checkout link that is not a secure payment URL and refused to
                follow it. Your order is untouched; contact support if this persists.
              </p>
              {order && (
                <p>
                  <Link className="btn btn--small" to={`/orders/${order.id}`}>
                    View order
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="alert alert--error" role="alert">
            <div>
              <strong>Checkout could not continue</strong>
              <p>{message ?? 'Please try again.'}</p>
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
                {!canDiscard && (
                  <button type="button" className="btn btn--small" onClick={retry}>
                    Try again
                  </button>
                )}
                {canDiscard && (
                  <Link className="btn btn--small" to="/cart" onClick={discardAndReturn}>
                    Discard this attempt and return to cart
                  </Link>
                )}
                {order && (
                  <Link className="btn btn--small" to={`/orders/${order.id}`}>
                    View order
                  </Link>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
