import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { getOrder } from '../api/ordersApi';
import { EmptyState, Loading } from '../components/Feedback';
import { OrderStatusBadge } from '../components/StatusBadge';
import { clearAttempt, loadAttempt } from '../lib/idempotency';
import { pollUntil } from '../lib/poll';
import { useCart } from '../state/cart';
import type { OrderResponse } from '../types/api';
import { formatMoney } from '../utils/money';

type Phase = 'polling' | 'confirmed' | 'failed' | 'timeout' | 'missing' | 'error';

/**
 * The Stripe redirect lands here — with a `session_id` the storefront ignores on purpose. A
 * redirect is not proof of payment: this page recovers the order from the stored checkout attempt
 * and believes only the order status the server reports after the webhook has been applied.
 */
export function PaymentSuccessPage() {
  const { clearCart } = useCart();
  const attempt = useMemo(() => loadAttempt(), []);
  const orderId = attempt?.orderId ?? null;

  const [phase, setPhase] = useState<Phase>(orderId ? 'polling' : 'missing');
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setPhase('missing');
      return;
    }
    const signal = { cancelled: false };
    let active = true;
    setPhase('polling');
    setMessage(null);

    pollUntil<OrderResponse>({
      load: () => getOrder(orderId),
      isDone: (candidate) =>
        candidate.status === 'CONFIRMED' ||
        candidate.status === 'CANCELLED' ||
        candidate.status === 'REJECTED',
      signal,
      onValue: (candidate) => {
        if (active) setOrder(candidate);
      },
      retryable: (err) => err instanceof ApiException && err.retryable,
    })
      .then((result) => {
        if (!active || result.status === 'cancelled') return;
        if (result.status === 'timeout') {
          setPhase('timeout');
          return;
        }
        const final = result.value as OrderResponse;
        setOrder(final);
        clearAttempt();
        if (final.status === 'CONFIRMED') {
          clearCart();
          setPhase('confirmed');
        } else {
          setMessage(final.failureReason ?? null);
          setPhase('failed');
        }
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiException && err.status === 404) {
          clearAttempt();
        }
        setMessage(errorMessage(err));
        setPhase('error');
      });

    return () => {
      active = false;
      signal.cancelled = true;
    };
  }, [orderId, runKey, clearCart]);

  if (phase === 'missing') {
    return (
      <>
        <div className="page-header">
          <h1>Payment received?</h1>
        </div>
        <EmptyState title="We could not find a pending order in this browser.">
          <p className="muted">
            Payment recovery uses an attempt stored here before the checkout started. If you paid
            from another browser or cleared site data, open My orders to see the authoritative
            status.
          </p>
          <p className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn--primary" to="/orders">
              View my orders
            </Link>
            <Link className="btn" to="/cart">
              Back to cart
            </Link>
          </p>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Payment status</h1>
        <p className="page-lede">
          This page waits for the order service to confirm the payment. The Stripe redirect by
          itself is never treated as proof that money moved.
        </p>
      </div>

      <div className="stack" aria-live="polite">
        {phase === 'polling' && (
          <div className="form-panel">
            <Loading label="Confirming your payment…" />
            {order && (
              <p>
                Order <span className="mono">{order.orderNumber}</span>{' '}
                <OrderStatusBadge status={order.status} />
              </p>
            )}
            <p className="muted">
              The payment provider's confirmation can take a few seconds to reach the store.
            </p>
          </div>
        )}

        {phase === 'confirmed' && order && (
          <div className="alert alert--success" role="status">
            <div>
              <strong>Payment confirmed</strong>
              <p>
                Order <span className="mono">{order.orderNumber}</span> for{' '}
                {formatMoney(order.totalAmount, order.currency)} is paid.
              </p>
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
                <Link className="btn btn--small" to={`/orders/${order.id}`}>
                  View order
                </Link>
                <Link className="btn btn--small" to="/">
                  Keep shopping
                </Link>
              </p>
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="alert alert--error" role="alert">
            <div>
              <strong>The order was not completed</strong>
              <p>{message ?? 'The order was cancelled.'}</p>
              {order && <OrderStatusBadge status={order.status} />}
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
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

        {phase === 'timeout' && (
          <div className="alert alert--warning" role="status">
            <div>
              <strong>Confirmation is taking longer than usual</strong>
              <p>
                The order is still being processed. Nothing is lost — check again in a moment, or
                open the order to see its current status.
              </p>
              {order && (
                <p>
                  Order <span className="mono">{order.orderNumber}</span>{' '}
                  <OrderStatusBadge status={order.status} />
                </p>
              )}
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
                <button type="button" className="btn btn--small" onClick={() => setRunKey((key) => key + 1)}>
                  Check again
                </button>
                {orderId && (
                  <Link className="btn btn--small" to={`/orders/${orderId}`}>
                    View order
                  </Link>
                )}
              </p>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="alert alert--error" role="alert">
            <div>
              <strong>We could not confirm the payment</strong>
              <p>{message ?? 'Please check My orders for the authoritative status.'}</p>
              <p className="row" style={{ marginTop: 'var(--space-3)' }}>
                <button type="button" className="btn btn--small" onClick={() => setRunKey((key) => key + 1)}>
                  Try again
                </button>
                <Link className="btn btn--small" to="/orders">
                  View my orders
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
