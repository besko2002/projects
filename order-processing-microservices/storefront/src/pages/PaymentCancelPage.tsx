import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { cancelOrder, getOrder } from '../api/ordersApi';
import { ErrorNotice, Loading } from '../components/Feedback';
import { OrderStatusBadge, RefundBadge } from '../components/StatusBadge';
import { clearAttempt, loadAttempt } from '../lib/idempotency';
import type { OrderResponse } from '../types/api';
import { browser, isSafePaymentUrl } from '../utils/url';
import { formatMoney } from '../utils/money';

type Phase = 'loading' | 'ready' | 'missing' | 'error';

function isPayable(order: OrderResponse): boolean {
  return (
    order.status === 'PENDING' ||
    order.status === 'STOCK_RESERVED' ||
    order.status === 'PAYMENT_PENDING'
  );
}

function isFinal(order: OrderResponse): boolean {
  return (
    order.status === 'CANCELLED' ||
    order.status === 'REJECTED' ||
    order.status === 'CANCELLATION_PENDING'
  );
}

/**
 * The Stripe cancel URL lands here. Closing the payment page did not cancel anything on the
 * server: the checkout may still be open, so the page shows the real order state and lets the
 * customer either pay or cancel explicitly.
 */
export function PaymentCancelPage() {
  const attempt = useMemo(() => loadAttempt(), []);
  const orderId = attempt?.orderId ?? null;

  const [phase, setPhase] = useState<Phase>(orderId ? 'loading' : 'missing');
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setPhase('missing');
      return;
    }
    let cancelled = false;
    setPhase('loading');
    setMessage(null);
    getOrder(orderId)
      .then((loaded) => {
        if (cancelled) return;
        setOrder(loaded);
        if (isFinal(loaded)) clearAttempt();
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiException && err.status === 404) {
          clearAttempt();
          setPhase('missing');
          return;
        }
        setMessage(errorMessage(err));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadKey]);

  const handleCancelOrder = async () => {
    if (!orderId || cancelling) return;
    setCancelling(true);
    setCancelMessage(null);
    try {
      const updated = await cancelOrder(orderId);
      setOrder(updated);
      if (isFinal(updated)) clearAttempt();
      setCancelMessage(
        updated.status === 'CANCELLATION_PENDING'
          ? 'Cancellation started. The order is cancelled once the payment provider confirms the refund.'
          : 'The order is cancelled.',
      );
    } catch (err) {
      setCancelMessage(errorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  if (phase === 'missing') {
    return (
      <>
        <div className="page-header">
          <h1>Back from payment</h1>
        </div>
        <div className="alert alert--info" role="status">
          <div>
            <strong>Returning from Stripe does not cancel your order.</strong>
            <p>
              No pending checkout was found in this browser, so there is nothing to resume here.
              Open My orders to see the authoritative state of any order you placed.
            </p>
            <p className="row" style={{ marginTop: 'var(--space-3)' }}>
              <Link className="btn btn--small" to="/orders">
                View my orders
              </Link>
              <Link className="btn btn--small" to="/cart">
                Back to cart
              </Link>
            </p>
          </div>
        </div>
      </>
    );
  }

  if (phase === 'error') {
    return (
      <>
        <div className="page-header">
          <h1>Back from payment</h1>
        </div>
        <ErrorNotice message={message ?? 'The order could not be loaded.'} onRetry={() => setReloadKey((key) => key + 1)} />
        <p>
          <Link className="btn" to="/orders">
            View my orders
          </Link>
        </p>
      </>
    );
  }

  if (phase === 'loading' || !order) {
    return (
      <>
        <div className="page-header">
          <h1>Back from payment</h1>
        </div>
        <Loading label="Checking your order…" />
      </>
    );
  }

  const payable = isPayable(order);
  const paymentUrlIsSafe = Boolean(order.paymentUrl && isSafePaymentUrl(order.paymentUrl));

  return (
    <>
      <div className="page-header">
        <h1>Back from payment</h1>
        <p className="page-lede">
          Returning from the payment page does not cancel your order: it stays payable until you
          pay or cancel it here.
        </p>
      </div>

      <div className="stack">
        <div className="order-summary">
          <div className="order-summary__row">
            <span>Order</span>
            <span className="mono">{order.orderNumber}</span>
          </div>
          <div className="order-summary__row">
            <span>Status</span>
            <span>
              <OrderStatusBadge status={order.status} /> <RefundBadge status={order.refundStatus} />
            </span>
          </div>
          <div className="order-summary__row order-summary__total">
            <span>Total</span>
            <span>{formatMoney(order.totalAmount, order.currency)}</span>
          </div>
        </div>

        {cancelMessage && (
          <div className="alert alert--info" role="status">
            <span>{cancelMessage}</span>
          </div>
        )}

        {order.status === 'CONFIRMED' && (
          <div className="alert alert--success" role="status">
            <div>
              <strong>Your payment went through.</strong>
              <p>The order is confirmed even though you came back through the cancel page.</p>
              <p>
                <Link className="btn btn--small" to={`/orders/${order.id}`}>
                  View order
                </Link>
              </p>
            </div>
          </div>
        )}

        {payable && (
          <div className="form-panel stack">
            <p>
              {order.paymentUrl
                ? 'Your checkout session is still open. You can pay it now, or cancel the order explicitly.'
                : 'The payment link is not ready yet. Refresh to check again before deciding.'}
            </p>
            {order.paymentUrl && !paymentUrlIsSafe && (
              <p className="field__error" role="alert">
                The stored payment link did not pass the safety check, so it will not be opened.
              </p>
            )}
            <div className="row">
              {order.paymentUrl && paymentUrlIsSafe && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => browser.redirect(order.paymentUrl as string)}
                >
                  Pay now
                </button>
              )}
              {!order.paymentUrl && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Refresh status
                </button>
              )}
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleCancelOrder}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
            <p className="muted">
              Cancelling an unpaid order releases its stock immediately. A refund is only mentioned
              once a payment actually exists.
            </p>
          </div>
        )}

        {!payable && order.status !== 'CONFIRMED' && (
          <div className="alert alert--info" role="status">
            <div>
              <strong>
                {order.status === 'CANCELLATION_PENDING' ? 'Cancellation in progress' : 'Order cancelled'}
              </strong>
              <p>
                {order.refundStatus === 'REQUESTED'
                  ? 'A refund has been requested. The money is returned only when the payment provider settles it — this page shows "Refund settled" once that happened.'
                  : order.refundStatus === 'REFUNDED'
                    ? 'The refund has been settled by the payment provider.'
                    : 'No payment was taken for this order, so there is nothing to refund.'}
              </p>
              {order.failureReason && <p className="muted">{order.failureReason}</p>}
              <p>
                <Link className="btn btn--small" to={`/orders/${order.id}`}>
                  View order
                </Link>
              </p>
            </div>
          </div>
        )}

        <p>
          <Link className="btn" to="/orders">
            My orders
          </Link>
        </p>
      </div>
    </>
  );
}
