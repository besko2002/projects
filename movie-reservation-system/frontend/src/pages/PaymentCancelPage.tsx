import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { TopBar } from '../components/TopBar';
import * as ticketsApi from '../api/ticketsApi';
import type { TicketDto } from '../types/ticket';
import { formatFullDateTime } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';

export function PaymentCancelPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [ticketId, setTicketId] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(PENDING_TICKET_KEY);
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });

  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [releasedMessage, setReleasedMessage] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadTicket() {
      try {
        let activeId = ticketId;
        if (!activeId) {
          // Fallback to newest ticket if sessionStorage was empty (P1-3, P2-1)
          const myTickets = await ticketsApi.getMyTickets(0, 5);
          const candidate =
            myTickets.content.find((t) => t.status === 'PENDING_PAYMENT') ||
            myTickets.content[0];
          if (candidate) {
            activeId = candidate.id;
            setTicketId(candidate.id);
          }
        }

        if (activeId) {
          const t = await ticketsApi.getTicket(activeId);
          if (!ignore) {
            setTicket(t);
            // Clear pending ticket storage if already in final status (P1-3)
            if (['PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'].includes(t.status)) {
              try {
                sessionStorage.removeItem(PENDING_TICKET_KEY);
              } catch {
                // Ignore
              }
            }
          }
        }
      } catch {
        if (!ignore) {
          setTicket(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadTicket();

    return () => {
      ignore = true;
    };
  }, [ticketId]);

  // "Try again" calls POST /api/tickets {scheduleId} (idempotent), stores ticketId, redirects (P1-3)
  const handleTryAgain = async () => {
    if (!ticket) {
      navigate('/');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const checkoutRes = await ticketsApi.checkoutTicket(ticket.scheduleId);
      sessionStorage.setItem(PENDING_TICKET_KEY, String(checkoutRes.ticketId));

      if (checkoutRes.checkoutUrl) {
        window.location.href = checkoutRes.checkoutUrl;
      } else {
        navigate('/payment/success');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen payment session.');
      setIsSubmitting(false);
    }
  };

  // "Release seats" calls DELETE /api/tickets/{id} and clears storage (P1-3)
  const handleReleaseSeats = async () => {
    if (!ticket) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await ticketsApi.cancelTicket(ticket.id);
      try {
        sessionStorage.removeItem(PENDING_TICKET_KEY);
      } catch {
        // Ignore
      }
      setReleasedMessage('Your held seats have been released. You can now select new showtimes or seats.');
      setTicket((prev) => (prev ? { ...prev, status: 'CANCELLED' } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to release seats.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const seatsString = ticket?.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ') || '';

  return (
    <div className="screen screen-container">
      <TopBar />

      <main className="wrap">
        <div style={{ maxWidth: '640px', margin: 'var(--space-8) auto' }}>
          <div className="kicker" style={{ textAlign: 'center' }}>Checkout Status</div>
          <h1 style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>Payment was cancelled</h1>

          <p className="soft" style={{ marginTop: 'var(--space-3)', fontSize: '16px', lineHeight: 1.6, textAlign: 'center' }}>
            You left the checkout session without completing payment. Your seats remain temporarily held for you until the hold window expires.
          </p>

          {error && (
            <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-6)' }}>
              {error}
            </div>
          )}

          {releasedMessage && (
            <div
              className="info-banner"
              role="status"
              style={{
                marginTop: 'var(--space-6)',
                background: '#fff1c9',
                border: '2px solid var(--ink)',
                padding: 'var(--space-4)',
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              {releasedMessage}
            </div>
          )}

          {!loading && ticket && (
            <div
              className="ticket"
              style={{
                background: 'var(--paper)',
                border: '3px solid var(--ink)',
                boxShadow: 'var(--shadow)',
                margin: 'var(--space-6) 0',
                padding: 'var(--space-6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h3 style={{ fontFamily: 'var(--display)', fontSize: '28px' }}>
                  {ticket.movieTitle}
                </h3>
                <span className="badge b-pend">● {ticket.status}</span>
              </div>

              <div className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
                {formatFullDateTime(ticket.scheduleStartTime)}
              </div>

              <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', borderTop: '2px dashed var(--sand)', paddingTop: 'var(--space-3)' }}>
                <span>Seats: <b>{seatsString}</b></span>
                <b style={{ fontSize: '20px' }}>{formatMoney(ticket.totalPrice, ticket.currency)}</b>
              </div>
            </div>
          )}

          <div className="acts" style={{ justifyContent: 'center', marginTop: 'var(--space-8)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {ticket && ticket.status === 'PENDING_PAYMENT' && !releasedMessage && (
              <>
                <button
                  type="button"
                  className="btn red"
                  disabled={isSubmitting}
                  onClick={handleTryAgain}
                >
                  {isSubmitting ? 'Opening checkout...' : 'Try again'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={isSubmitting}
                  onClick={handleReleaseSeats}
                >
                  Release seats
                </button>
              </>
            )}

            <Link to="/" className="btn">
              Browse movies
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
