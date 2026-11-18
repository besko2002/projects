import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { cancelOrder, getOrder, listOrderEvents } from '../api/ordersApi';
import { getPaymentForOrder } from '../api/paymentsApi';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { OrderStatusBadge, PaymentStatusBadge, RefundBadge } from '../components/StatusBadge';
import type { OrderEventResponse, OrderResponse, PaymentResponse } from '../types/api';
import { browser, isSafePaymentUrl } from '../utils/url';
import { formatMoney } from '../utils/money';

function isPayable(order: OrderResponse): boolean {
  return (
    order.status === 'PENDING' ||
    order.status === 'STOCK_RESERVED' ||
    order.status === 'PAYMENT_PENDING'
  );
}

function canCancel(order: OrderResponse): boolean {
  return isPayable(order) || order.status === 'CONFIRMED';
}

export function OrderDetailPage() {
  const { id = '' } = useParams();

  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [payment, setPayment] = useState<PaymentResponse | null>(null);
  const [events, setEvents] = useState<OrderEventResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setCancelMessage(null);

    getOrder(id)
      .then(async (loaded) => {
        if (cancelled) return;
        setOrder(loaded);
        // Secondary data must never block the order itself: a missing payment is normal (the
        // saga may not have reached that step) and the timeline is a bonus view.
        const [loadedPayment, loadedEvents] = await Promise.allSettled([
          getPaymentForOrder(id),
          listOrderEvents(id),
        ]);
        if (cancelled) return;
        setPayment(loadedPayment.status === 'fulfilled' ? loadedPayment.value : null);
        setEvents(loadedEvents.status === 'fulfilled' ? loadedEvents.value : null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiException && err.status === 404) {
          setNotFound(true);
        } else {
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const handleCancel = async () => {
    if (!order || cancelling) return;
    setCancelling(true);
    setCancelMessage(null);
    try {
      const updated = await cancelOrder(order.id);
      setOrder(updated);
      setCancelMessage(
        updated.status === 'CANCELLATION_PENDING'
          ? 'Cancellation started. The refund is in progress; it is settled only when the payment provider confirms it.'
          : updated.status === 'CANCELLED'
            ? 'The order is cancelled.'
            : `Cancellation requested — the order is now ${updated.status.toLowerCase()}.`,
      );
    } catch (err) {
      setCancelMessage(errorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !order && !notFound) {
    return <Loading label="Loading order…" />;
  }

  if (notFound) {
    return (
      <EmptyState title="Order not found">
        <p className="muted">It may belong to another account, or the link may be out of date.</p>
        <p>
          <Link className="btn" to="/orders">
            Back to my orders
          </Link>
        </p>
      </EmptyState>
    );
  }

  if (error) {
    return <ErrorNotice message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  if (!order) {
    return null;
  }

  const payable = isPayable(order);
  const paymentUrlIsSafe = Boolean(order.paymentUrl && isSafePaymentUrl(order.paymentUrl));

  return (
    <>
      <div className="page-header">
        <p className="muted">
          <Link to="/orders">My orders</Link> / <span className="mono">{order.orderNumber}</span>
        </p>
        <h1>Order {order.orderNumber}</h1>
        <p className="row">
          <OrderStatusBadge status={order.status} />
          <RefundBadge status={order.refundStatus} />
          {payment?.simulated && <span className="badge badge--simulated">Simulated payment</span>}
        </p>
      </div>

      {cancelMessage && (
        <div className="alert alert--info" role="status">
          <span>{cancelMessage}</span>
        </div>
      )}

      {(order.status === 'REJECTED' || order.status === 'CANCELLED') && order.failureReason && (
        <div className={`alert ${order.status === 'REJECTED' ? 'alert--error' : 'alert--warning'}`} role="status">
          <div>
            <strong>{order.status === 'REJECTED' ? 'Order rejected' : 'Order cancelled'}</strong>
            <span>{order.failureReason}</span>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <section className="stack" aria-labelledby="order-items-heading">
          <h2 id="order-items-heading">Items</h2>
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Order lines and server-priced totals</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Unit price</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={`${item.productId}-${item.productName}`}>
                    <td>{item.productName}</td>
                    <td className="table--num">{formatMoney(item.unitPrice, order.currency)}</td>
                    <td>{item.quantity}</td>
                    <td className="table--num">{formatMoney(item.lineTotal, order.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="order-summary">
            <div className="order-summary__row">
              <span>Ordered</span>
              <span>{new Date(order.createdAt).toLocaleString()}</span>
            </div>
            <div className="order-summary__row">
              <span>Last update</span>
              <span>{new Date(order.updatedAt).toLocaleString()}</span>
            </div>
            <div className="order-summary__row order-summary__total">
              <span>Total charged</span>
              <span>{formatMoney(order.totalAmount, order.currency)}</span>
            </div>
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Totals are the server's, in {order.currency}; they are never recalculated in the
              browser.
            </p>
          </div>
        </section>

        <aside className="stack" aria-labelledby="order-actions-heading">
          <h2 id="order-actions-heading">Actions</h2>

          {payable && (
            <div className="form-panel stack">
              <p>
                {order.paymentUrl
                  ? 'This order is waiting for payment. The checkout session stays payable until it expires or you cancel.'
                  : order.status === 'PAYMENT_PENDING'
                    ? 'The payment step is in progress. Refresh to see the latest state.'
                    : 'The saga is preparing the checkout link.'}
              </p>
              {order.paymentUrl && !paymentUrlIsSafe && (
                <p className="field__error" role="alert">
                  The stored payment link did not pass the safety check and will not be opened.
                </p>
              )}
              <div className="row">
                {order.paymentUrl && paymentUrlIsSafe && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => { window.localStorage.setItem("paynow_return_order_id", order.id); browser.redirect(order.paymentUrl as string); }}
                  >
                    Pay now
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => setReloadKey((key) => key + 1)}
                  disabled={loading}
                >
                  Refresh
                </button>
              </div>
            </div>
          )}

          {canCancel(order) && (
            <div className="form-panel stack">
              <p>
                {order.status === 'CONFIRMED'
                  ? 'Cancelling a paid order starts a refund. The order stays in cancellation pending until the provider confirms the money was returned.'
                  : 'Cancelling now releases any reserved stock. No payment exists yet, so nothing is refunded.'}
              </p>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          )}

          {(order.refundStatus !== 'NONE' || payment) && (
            <div className="form-panel stack">
              <h2>Payment and refund</h2>
              {payment ? (
                <>
                  <p>
                    <PaymentStatusBadge status={payment.status} />{' '}
                    {payment.simulated && <span className="badge badge--simulated">Simulated</span>}
                  </p>
                  {payment.failureReason && <p className="muted">{payment.failureReason}</p>}
                </>
              ) : (
                <p className="muted">No payment was recorded for this order.</p>
              )}
              {order.refundStatus === 'REQUESTED' && (
                <p>
                  <RefundBadge status="REQUESTED" /> The refund is requested but not settled yet:
                  the money is returned only when the payment provider confirms it.
                </p>
              )}
              {order.refundStatus === 'REFUNDED' && (
                <p>
                  <RefundBadge status="REFUNDED" /> The payment provider confirmed the refund.
                </p>
              )}
              {order.refundStatus === 'NONE' && order.status === 'CANCELLED' && (
                <p className="muted">This order was cancelled without a payment, so no refund was
                  needed.</p>
              )}
            </div>
          )}

          <h2>Timeline</h2>
          {events && events.length > 0 ? (
            <>
              <p className="muted">Events recorded by the order service, oldest first.</p>
              <ol className="stack" style={{ paddingLeft: 'var(--space-4)' }}>
                {events.map((event, index) => (
                  <li key={`${event.eventType}-${event.createdAt}-${index}`}>
                    <span className="mono">{event.eventType}</span>
                    <br />
                    <span className="muted">
                      {new Date(event.createdAt).toLocaleString()} · {event.topic}
                      {event.publishedAt ? ' · published' : ' · queued'}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">
              Current progress only: the detailed event timeline is not available right now. The
              status above is the authoritative state recorded by the order service.
            </p>
          )}
        </aside>
      </div>

      <p style={{ marginTop: 'var(--space-5)' }}>
        <Link className="btn" to="/orders">
          Back to my orders
        </Link>
      </p>
    </>
  );
}
