import type { OrderStatus, PaymentStatus, RefundStatus } from '../types/api';

/**
 * Status is never communicated by colour alone: every badge carries its own words, and the
 * styling only reinforces the text.
 */
const ORDER_LABELS: Record<OrderStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Awaiting stock', tone: 'badge--pending' },
  STOCK_RESERVED: { label: 'Stock reserved', tone: 'badge--progress' },
  PAYMENT_PENDING: { label: 'Awaiting payment', tone: 'badge--progress' },
  CONFIRMED: { label: 'Confirmed', tone: 'badge--confirmed' },
  CANCELLATION_PENDING: { label: 'Cancellation pending', tone: 'badge--progress' },
  CANCELLED: { label: 'Cancelled', tone: 'badge--cancelled' },
  REJECTED: { label: 'Rejected', tone: 'badge--rejected' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, tone } = ORDER_LABELS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function RefundBadge({ status }: { status: RefundStatus }) {
  if (status === 'NONE') return null;
  if (status === 'REQUESTED') {
    return <span className="badge badge--pending">Refund requested</span>;
  }
  return <span className="badge badge--refunded">Refund settled</span>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  switch (status) {
    case 'AWAITING_CUSTOMER':
      return <span className="badge badge--pending">Awaiting customer</span>;
    case 'AUTHORIZED':
      return <span className="badge badge--confirmed">Paid</span>;
    case 'FAILED':
      return <span className="badge badge--failed">Payment failed</span>;
    case 'REFUNDED':
      return <span className="badge badge--refunded">Refunded</span>;
  }
}
