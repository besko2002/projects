import React from 'react';
import type { TicketDto } from '../types/ticket';
import { formatCancellationCutoff, formatFullDateTime, isPastCutoff } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

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
  const seatsString = ticket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ');
  const colorIndex = (ticket.id % 4) + 1;

  const isPaid = ticket.status === 'PAID';
  const isPending = ticket.status === 'PENDING_PAYMENT';
  const isRefunded = ticket.status === 'REFUNDED';
  const isCancelled = ticket.status === 'CANCELLED';
  const isExpired = ticket.status === 'EXPIRED';

  const pastCutoff = isPastCutoff(ticket.scheduleStartTime);
  const cutoffText = formatCancellationCutoff(ticket.scheduleStartTime);

  return (
    <article className="ticket-row" aria-labelledby={`ticket-title-${ticket.id}`}>
      <div className={`poster-stub p${colorIndex}`} aria-hidden="true">
        <span className="stamp">#{ticket.id}</span>
        <b>{ticket.movieTitle}</b>
      </div>

      <div className="ticket-body">
        <div className="ticket-main-info">
          <div className="ticket-status-pill">
            {isPaid && <span className="badge b-paid">● PAID</span>}
            {isPending && <span className="badge b-pend">● AWAITING PAYMENT</span>}
            {isRefunded && <span className="badge b-ref">● REFUNDED</span>}
            {isCancelled && <span className="badge b-ref">● CANCELLED</span>}
            {isExpired && <span className="badge b-ref" style={{ opacity: 0.6 }}>● EXPIRED</span>}
          </div>

          <h3 id={`ticket-title-${ticket.id}`} style={{ marginTop: 'var(--space-2)' }}>
            {ticket.movieTitle}
          </h3>
          <div className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
            {formatFullDateTime(ticket.scheduleStartTime)}
          </div>
        </div>

        <div className="ticket-seat-info">
          <span className="kicker-label">SEATS</span>
          <b style={{ fontSize: '16px' }}>{seatsString || `${ticket.seatCount} seat(s)`}</b>
          <div className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
            {formatMoney(ticket.totalPrice, ticket.currency)}
            {isRefunded && ' (refunded)'}
          </div>
        </div>

        <div className="ticket-actions">
          {isPaid && (
            <>
              {onViewVoucher && (
                <button
                  type="button"
                  className="btn btn-compact"
                  onClick={() => onViewVoucher(ticket)}
                >
                  View voucher
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  className="btn btn-compact btn-danger"
                  disabled={isCancelling || pastCutoff}
                  onClick={() => onCancel(ticket.id)}
                  title={pastCutoff ? 'Cutoff has passed (within 2 hours of show)' : `Refundable until ${cutoffText}`}
                >
                  {isCancelling ? 'Processing...' : 'Cancel & refund'}
                </button>
              )}
              {pastCutoff && (
                <small className="soft" style={{ fontSize: '11px' }}>
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
                  className="btn btn-compact red"
                  onClick={() => onPay(ticket)}
                >
                  Complete payment
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  className="btn btn-compact btn-danger"
                  disabled={isCancelling}
                  onClick={() => onCancel(ticket.id)}
                >
                  Release seats
                </button>
              )}
            </>
          )}

          {(isRefunded || isCancelled || isExpired) && (
            <span className="soft" style={{ fontSize: '13px' }}>
              {isRefunded ? 'Refunded to your card' : isCancelled ? 'Cancelled' : 'Expired hold'}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
