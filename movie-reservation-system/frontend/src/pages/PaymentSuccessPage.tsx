import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import type { TicketDto } from '../types/ticket';
import * as ticketsApi from '../api/ticketsApi';
import { formatCancellationCutoff, formatFullDateTime, formatTime, formatDateShort } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';

export function PaymentSuccessPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [ticketId] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(PENDING_TICKET_KEY);
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });

  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(() => !!ticketId);
  const [timeoutReached, setTimeoutReached] = useState<boolean>(false);
  const [error] = useState<string | null>(() => {
    return ticketId
      ? null
      : 'No active booking reference found. If you completed payment, please check My tickets.';
  });

  const attemptsRef = useRef<number>(0);

  useEffect(() => {
    if (!ticketId) return;

    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        attemptsRef.current += 1;
        const currentTicket = await ticketsApi.getTicket(ticketId!);
        if (!isMounted) return;

        setTicket(currentTicket);

        if (currentTicket.status === 'PAID') {
          setIsPolling(false);
          try {
            sessionStorage.removeItem(PENDING_TICKET_KEY);
          } catch {
            // Ignore
          }
          return;
        }

        // Poll up to 45 attempts (approx 45-60 seconds)
        if (attemptsRef.current >= 45) {
          setIsPolling(false);
          setTimeoutReached(true);
          return;
        }

        timer = setTimeout(poll, 800);
      } catch {
        if (!isMounted) return;
        setIsPolling(false);
      }
    }

    void poll();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [ticketId]);

  const seatsString = ticket?.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ') || '';
  const gradient = getPosterGradient(ticket?.movieTitle || ticket?.id || 1);

  return (
    <div className="screen-container">
      {/* Progress Steps Header */}
      <header className="top-bar">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="logo"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          aria-label="CineBook Home"
        >
          <div className="logo-mark" aria-hidden="true">▶</div>
          <span>CineBook</span>
        </button>

        <div className="steps" aria-label="Booking steps" style={{ marginLeft: 'var(--space-6)' }}>
          <span className="done" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">✓</span>
            Showtime
          </span>
          <span className="bar" aria-hidden="true" />
          <span className="done" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">✓</span>
            Seats
          </span>
          <span className="bar" aria-hidden="true" />
          <span className="done" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">✓</span>
            Payment
          </span>
          <span className="bar" aria-hidden="true" />
          <span className="cur" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">4</span>
            Ticket
          </span>
        </div>
      </header>

      <main className="wrap">
        {isPolling && (
          <div style={{ textAlign: 'center', padding: 'var(--space-12) 0' }}>
            <div
              className="skeleton"
              style={{ width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto var(--space-6)' }}
            />
            <h2>Confirming payment with Stripe...</h2>
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Waiting for webhook payment verification. Your seats are locked in.
            </p>
          </div>
        )}

        {!isPolling && timeoutReached && (
          <div style={{ maxWidth: '600px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--amber)' }}>Payment verification in progress</h2>
            <p className="muted" style={{ margin: 'var(--space-4) 0 var(--space-6)', lineHeight: 1.6 }}>
              Stripe is still processing the payment event. You can check your ticket status at any time in My tickets.
            </p>
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <Link to="/tickets" className="btn btn-primary">
                View My tickets
              </Link>
              <Link to="/" className="btn btn-ghost">
                Back to movies
              </Link>
            </div>
          </div>
        )}

        {!isPolling && error && (
          <div style={{ maxWidth: '600px', margin: 'var(--space-8) auto' }}>
            <div className="error-banner">{error}</div>
            <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
              <Link to="/tickets" className="btn btn-primary">
                Go to My tickets
              </Link>
            </div>
          </div>
        )}

        {!isPolling && ticket && ticket.status === 'PAID' && (
          <div className="success-layout">
            <div>
              <div className="tick-icon" aria-hidden="true">✓</div>
              <h1>You&apos;re going to the movies!</h1>
              <p className="muted" style={{ marginTop: 'var(--space-3)', fontSize: '17px', lineHeight: 1.6, maxWidth: '560px' }}>
                Payment confirmed by Stripe. Your {ticket.seatCount} {ticket.seatCount === 1 ? 'seat is' : 'seats are'} locked in —
                show this ticket at the cinema entrance. A copy is always accessible in{' '}
                <b style={{ color: 'var(--ink)' }}>My tickets</b>.
              </p>

              <div className="btn-row" style={{ marginTop: 'var(--space-6)', maxWidth: '400px' }}>
                <Link to="/tickets" className="btn btn-primary">
                  View my tickets
                </Link>
                <Link to="/" className="btn btn-ghost">
                  Back to movies
                </Link>
              </div>

              <div
                style={{
                  marginTop: 'var(--space-8)',
                  maxWidth: '560px',
                  background: 'var(--mint-bg)',
                  border: '1px solid rgba(61, 220, 151, 0.35)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  fontSize: '13px',
                }}
              >
                <span style={{ fontSize: '20px' }}>↺</span>
                <div>
                  Changed your plans? Cancel for a full refund
                  <br />
                  <span className="faint">
                    refundable until {formatCancellationCutoff(ticket.scheduleStartTime)} (2 hours before the show)
                  </span>
                </div>
              </div>
            </div>

            {/* Ticket Voucher Display */}
            <div className="ticket-voucher" role="region" aria-label="Ticket voucher">
              <div className="t-top">
                <div
                  className="poster"
                  style={{ background: gradient }}
                  aria-hidden="true"
                >
                  <div className="ptitle" style={{ fontSize: '15px' }}>{ticket.movieTitle}</div>
                </div>

                <div style={{ flex: 1 }}>
                  <span className="badge b-paid">● PAID</span>
                  <h2 style={{ marginTop: 'var(--space-2)', fontSize: '24px' }}>
                    {ticket.movieTitle}
                  </h2>
                  <div className="t-grid">
                    <div>
                      <small>Date</small>
                      <b>{formatDateShort(ticket.scheduleStartTime)}</b>
                    </div>
                    <div>
                      <small>Time</small>
                      <b>{formatTime(ticket.scheduleStartTime)}</b>
                    </div>
                    <div>
                      <small>Seats</small>
                      <b>{seatsString}</b>
                    </div>
                    <div>
                      <small>Paid</small>
                      <b>${ticket.totalPrice.toFixed(2)}</b>
                    </div>
                    <div>
                      <small>Ticket #</small>
                      <b>#{ticket.id}</b>
                    </div>
                  </div>
                </div>
              </div>

              <div className="perf" aria-hidden="true" />

              <div className="t-bottom">
                <div>
                  <small className="faint" style={{ fontSize: '12px', fontWeight: 750, letterSpacing: '0.08em' }}>
                    SHOW AT ENTRANCE
                  </small>
                  <div style={{ fontSize: '15px', fontWeight: 700, marginTop: 'var(--space-1)', letterSpacing: '0.05em' }}>
                    CB-{ticket.id}-{ticket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join('')}
                  </div>
                </div>
                <div className="faint" style={{ fontSize: '12px' }}>
                  {formatFullDateTime(ticket.scheduleStartTime)}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
