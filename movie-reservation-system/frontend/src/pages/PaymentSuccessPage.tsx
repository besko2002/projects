import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router';
import type { TicketDto } from '../types/ticket';
import * as ticketsApi from '../api/ticketsApi';
import { ApiException } from '../api/client';
import { formatCancellationCutoff, formatFullDateTime, formatTime, formatDateShort } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';
import { TopBar } from '../components/TopBar';

const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';
const POLL_BUDGET_MS = 60000; // ~60s budget (P2-1)

export function PaymentSuccessPage(): React.JSX.Element {
  const [ticketId, setTicketId] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(PENDING_TICKET_KEY);
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });

  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [timeoutReached, setTimeoutReached] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const startTimeRef = useRef<number>(0);
  const transientRetriesRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<(id: number) => Promise<void>>(async () => {});

  const runPolling = useCallback(async (idToPoll: number) => {
    try {
      const currentTicket = await ticketsApi.getTicket(idToPoll);
      setTicket(currentTicket);

      // P2-1: Treat every status other than PENDING_PAYMENT as final and render it
      if (currentTicket.status !== 'PENDING_PAYMENT') {
        setIsPolling(false);
        try {
          sessionStorage.removeItem(PENDING_TICKET_KEY);
        } catch {
          // Ignore
        }
        return;
      }

      // Check poll budget (~60s)
      if (Date.now() - startTimeRef.current >= POLL_BUDGET_MS) {
        setIsPolling(false);
        setTimeoutReached(true);
        return;
      }

      timerRef.current = setTimeout(() => {
        void pollRef.current(idToPoll);
      }, 1000);
    } catch (err) {
      if (err instanceof ApiException) {
        // Stop with a clear message on 401/403/404 (P2-1)
        if (err.status === 401 || err.status === 403) {
          setIsPolling(false);
          setError('Session expired or access denied. Please sign in to view your tickets.');
          return;
        }
        if (err.status === 404) {
          setIsPolling(false);
          setError('Ticket not found. Please check My tickets for your booking history.');
          return;
        }
      }

      // Retry transient errors with backoff
      transientRetriesRef.current += 1;
      const backoff = Math.min(1000 * Math.pow(1.4, transientRetriesRef.current), 4000);

      if (Date.now() + backoff - startTimeRef.current < POLL_BUDGET_MS) {
        timerRef.current = setTimeout(() => {
          void pollRef.current(idToPoll);
        }, backoff);
      } else {
        setIsPolling(false);
        setTimeoutReached(true);
      }
    }
  }, []);

  useEffect(() => {
    pollRef.current = runPolling;
  }, [runPolling]);

  useEffect(() => {
    let ignore = false;
    startTimeRef.current = Date.now();
    transientRetriesRef.current = 0;

    async function init() {
      let activeId = ticketId;

      // If sessionStorage is empty, fall back to newest ticket from GET /api/tickets/me (P2-1)
      if (!activeId) {
        try {
          const myTickets = await ticketsApi.getMyTickets(0, 1);
          if (myTickets.content && myTickets.content.length > 0) {
            activeId = myTickets.content[0].id;
            setTicketId(activeId);
          } else {
            if (!ignore) {
              setIsPolling(false);
              setError('No active booking reference found. If you completed payment, please check My tickets.');
            }
            return;
          }
        } catch {
          if (!ignore) {
            setIsPolling(false);
            setError('Could not verify recent booking. Please check My tickets.');
          }
          return;
        }
      }

      if (!ignore && activeId) {
        void runPolling(activeId);
      }
    }

    void init();

    return () => {
      ignore = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ticketId, runPolling]);

  // "Check again" restarts polling with fresh budget (P2-1)
  const handleCheckAgain = () => {
    if (!ticketId) return;
    startTimeRef.current = Date.now();
    transientRetriesRef.current = 0;
    setTimeoutReached(false);
    setError(null);
    setIsPolling(true);
    void runPolling(ticketId);
  };

  const seatsString = ticket?.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ') || '';

  return (
    <div className="screen screen-container">
      <TopBar step={4} />

      <main className="wrap">
        {isPolling && (
          <div style={{ textAlign: 'center', padding: 'var(--space-12) 0' }}>
            <div className="skeleton" style={{ width: '80px', height: '80px', margin: '0 auto var(--space-4)', border: '3px solid var(--ink)' }} />
            <h2>Confirming payment with Stripe...</h2>
            <p className="soft" style={{ marginTop: 'var(--space-2)' }}>
              Awaiting webhook payment confirmation. Your seats are held.
            </p>
          </div>
        )}

        {!isPolling && timeoutReached && (
          <div style={{ maxWidth: '640px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
            <div className="kicker">Payment verification</div>
            <h2 style={{ marginTop: 'var(--space-2)' }}>Payment verification in progress</h2>
            <p className="soft" style={{ margin: 'var(--space-4) 0 var(--space-6)', lineHeight: 1.6 }}>
              Stripe is still processing the payment confirmation webhook. Your booking is safe and will update automatically.
            </p>
            <div className="acts" style={{ justifyContent: 'center', display: 'flex', gap: 'var(--space-3)' }}>
              <button type="button" className="btn red" onClick={handleCheckAgain}>
                Check again
              </button>
              <Link to="/tickets" className="btn">
                View My tickets
              </Link>
            </div>
          </div>
        )}

        {!isPolling && error && (
          <div style={{ maxWidth: '640px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
            <div className="error-banner" role="alert">{error}</div>
            <div className="acts" style={{ justifyContent: 'center', marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)' }}>
              <button type="button" className="btn red" onClick={handleCheckAgain}>
                Check again
              </button>
              <Link to="/tickets" className="btn">
                Go to My tickets
              </Link>
            </div>
          </div>
        )}

        {!isPolling && ticket && ticket.status === 'PAID' && (
          <div className="success-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 'var(--space-8)', marginTop: 'var(--space-4)' }}>
            <div>
              <div className="kicker">Booking Confirmed</div>
              <h1 style={{ marginTop: 'var(--space-2)' }}>You&apos;re going to the movies!</h1>
              <p className="soft" style={{ marginTop: 'var(--space-3)', fontSize: '16px', lineHeight: 1.6, maxWidth: '600px' }}>
                Payment confirmed by Stripe. Your {ticket.seatCount} {ticket.seatCount === 1 ? 'seat is' : 'seats are'} locked in —
                show this ticket voucher at the cinema entrance. A copy is always accessible in{' '}
                <Link to="/tickets" style={{ color: 'var(--red)', fontWeight: 800 }}>My tickets</Link>.
              </p>

              <div className="acts" style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)' }}>
                <Link to="/tickets" className="btn red">
                  View my tickets
                </Link>
                <Link to="/" className="btn">
                  Back to movies
                </Link>
              </div>

              <div
                style={{
                  marginTop: 'var(--space-8)',
                  background: 'var(--paper)',
                  border: '3px solid var(--ink)',
                  boxShadow: 'var(--shadow)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                }}
              >
                <span style={{ fontSize: '24px' }}>↺</span>
                <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                  <b>Changed your plans?</b> Cancel for a full refund until{' '}
                  <b>{formatCancellationCutoff(ticket.scheduleStartTime)}</b> (2 hours before showtime).
                </div>
              </div>
            </div>

            {/* Retro Ticket Voucher Card */}
            <div
              className="ticket"
              style={{
                background: 'var(--paper)',
                border: '3px solid var(--ink)',
                boxShadow: 'var(--shadow)',
                position: 'relative',
              }}
              role="region"
              aria-label="Ticket voucher"
            >
              <div className="poster p2" style={{ height: '140px' }}>
                <span className="stamp">● PAID</span>
                <b style={{ fontSize: '32px' }}>{ticket.movieTitle}</b>
              </div>

              <div className="perf" aria-hidden="true" />

              <div className="stub">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', fontSize: '14px' }}>
                  <div>
                    <span className="soft">DATE</span>
                    <div><b>{formatDateShort(ticket.scheduleStartTime)}</b></div>
                  </div>
                  <div>
                    <span className="soft">TIME</span>
                    <div><b>{formatTime(ticket.scheduleStartTime)}</b></div>
                  </div>
                  <div>
                    <span className="soft">SEATS</span>
                    <div><b>{seatsString}</b></div>
                  </div>
                  <div>
                    <span className="soft">TOTAL PAID</span>
                    <div><b>{formatMoney(ticket.totalPrice, ticket.currency)}</b></div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 'var(--space-4)',
                    borderTop: '2px dashed var(--sand)',
                    paddingTop: 'var(--space-3)',
                    textAlign: 'center',
                  }}
                >
                  <span className="soft" style={{ fontSize: '11px', letterSpacing: '0.12em', fontWeight: 800 }}>
                    SHOW AT ENTRANCE
                  </span>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '24px', letterSpacing: '0.1em', marginTop: 'var(--space-1)' }}>
                    CB-{ticket.id}-{ticket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join('')}
                  </div>
                  <div className="soft" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}>
                    {formatFullDateTime(ticket.scheduleStartTime)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isPolling && ticket && ticket.status !== 'PAID' && (
          <div style={{ maxWidth: '640px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
            <div className="kicker">Ticket #{ticket.id}</div>
            <h2 style={{ marginTop: 'var(--space-2)' }}>Ticket Status: {ticket.status}</h2>
            <p className="soft" style={{ margin: 'var(--space-3) 0 var(--space-6)' }}>
              {ticket.status === 'CANCELLED'
                ? 'This booking was cancelled and its seats were released.'
                : ticket.status === 'REFUNDED'
                ? 'This booking was cancelled and refunded to your payment method.'
                : ticket.status === 'EXPIRED'
                ? 'The payment window for this ticket expired.'
                : `Current status is ${ticket.status}.`}
            </p>
            <div className="acts" style={{ justifyContent: 'center', display: 'flex', gap: 'var(--space-3)' }}>
              <Link to="/tickets" className="btn red">
                View My tickets
              </Link>
              <Link to="/" className="btn">
                Browse movies
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
