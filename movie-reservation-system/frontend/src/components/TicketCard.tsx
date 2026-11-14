import React from 'react';
import type { TicketDto } from '../types/ticket';
import { formatCancellationCutoff, formatFullDateTime, isPastCutoff } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

interface TicketCardProps {
  ticket: TicketDto;
  onCancel?: (ticketId: number) => void;
  onPay?: (ticket: TicketDto) => void;
  onViewVoucher?: (ticket: TicketDto) => void;
  isCancelling?: boolean;
}

export function TicketCard({
  ticket,
  onCancel,
  onPay,
  onViewVoucher,
  isCancelling = false,
}: TicketCardProps): React.JSX.Element {
  const gradient = getPosterGradient(ticket.movieTitle || ticket.id);
  const seatsString = ticket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ');

  const isPaid = ticket.status === 'PAID';
  const isPending = ticket.status === 'PENDING_PAYMENT';
  const isRefunded = ticket.status === 'REFUNDED';
  const isCancelled = ticket.status === 'CANCELLED';
  const isExpired = ticket.status === 'EXPIRED';

  const pastCutoff = isPastCutoff(ticket.scheduleStartTime);
  const cutoffText = formatCancellationCutoff(ticket.scheduleStartTime);

  return (
    <article className="titem" aria-labelledby={`ticket-title-${ticket.id}`}>
      <div
        className="poster"
        style={{ background: gradient }}
        aria-hidden="true"
      >
        <div className="ptitle" style={{ fontSize: '13px' }}>{ticket.movieTitle}</div>
      </div>

      <div>
        {isPaid && <span className="badge b-paid">● PAID</span>}
        {isPending && <span className="badge b-pend">● AWAITING PAYMENT</span>}
        {isRefunded && <span className="badge b-ref">● REFUNDED</span>}
        {isCancelled && <span className="badge b-ref">● CANCELLED</span>}
        {isExpired && <span className="badge b-ref" style={{ opacity: 0.6 }}>● EXPIRED</span>}

        <h3 id={`ticket-title-${ticket.id}`} style={{ marginTop: 'var(--space-2)' }}>
          {ticket.movieTitle}
        </h3>
        <div className="muted" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
          {formatFullDateTime(ticket.scheduleStartTime)}
        </div>
      </div>

      <div>
        <div className="faint" style={{ fontSize: '12px', fontWeight: 750, letterSpacing: '0.08em' }}>
          SEATS
        </div>
        <b style={{ fontSize: '15px' }}>{seatsString || `${ticket.seatCount} seat(s)`}</b>
        <div className="muted" style={{ fontSize: '13px', marginTop: 'var(--space-1)' }}>
          ${ticket.totalPrice.toFixed(2)} {ticket.currency.toUpperCase()}
          {isRefunded && ' refunded'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        {isPaid && (
          <>
            {onViewVoucher && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => onViewVoucher(ticket)}
              >
                View voucher
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                className="btn btn-danger btn-compact"
                disabled={isCancelling || pastCutoff}
                onClick={() => onCancel(ticket.id)}
                title={pastCutoff ? 'Cutoff has passed (within 2 hours of show)' : `Refundable until ${cutoffText}`}
              >
                {isCancelling ? 'Processing...' : 'Cancel & refund'}
              </button>
            )}
            {pastCutoff && (
              <small className="faint" style={{ fontSize: '11px' }}>
                Cancellation cutoff passed
              </small>
            )}
          </>
        )}

        {isPending && (
          <>
            {onPay && (
              <button
                type="button"
                className="btn btn-primary btn-compact"
                onClick={() => onPay(ticket)}
              >
                Complete payment
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                className="btn btn-danger btn-compact"
                disabled={isCancelling}
                onClick={() => onCancel(ticket.id)}
              >
                Cancel
              </button>
            )}
          </>
        )}

        {(isRefunded || isCancelled || isExpired) && (
          <span className="faint" style={{ fontSize: '13px' }}>
            {isRefunded ? 'Refunded to your card' : isCancelled ? 'Cancelled' : 'Expired hold'}
          </span>
        )}
      </div>
    </article>
  );
}
