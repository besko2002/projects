import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { TopBar } from '../components/TopBar';
import * as ticketsApi from '../api/ticketsApi';
import type { TicketDto } from '../types/ticket';
import { formatFullDateTime } from '../utils/dateUtils';

const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';

export function PaymentCancelPage(): React.JSX.Element {
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
  const [loading, setLoading] = useState<boolean>(() => !!ticketId);

  useEffect(() => {
    let ignore = false;
    if (ticketId) {
      ticketsApi
        .getTicket(ticketId)
        .then((t) => {
          if (!ignore) {
            setTicket(t);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!ignore) {
            setTicket(null);
            setLoading(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [ticketId]);

  const handleTryAgain = () => {
    if (ticket) {
      navigate(`/book/${ticket.scheduleId}`);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="screen-container">
      <TopBar />

      <main className="wrap">
        <div style={{ maxWidth: '600px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
          <div
            style={{
              width: '78px',
              height: '78px',
              borderRadius: '50%',
              background: 'rgba(255, 181, 71, 0.15)',
              display: 'grid',
              placeItems: 'center',
              fontSize: '36px',
              color: 'var(--amber)',
              margin: '0 auto var(--space-6)',
            }}
            aria-hidden="true"
          >
            !
          </div>

          <h1>Payment was cancelled</h1>
          <p className="muted" style={{ marginTop: 'var(--space-3)', fontSize: '16px', lineHeight: 1.6 }}>
            You cancelled your Stripe payment session. Your seats are still temporarily held for you.
          </p>

          {!loading && ticket && (
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-6)',
                margin: 'var(--space-6) 0',
                textAlign: 'left',
              }}
            >
              <h3>{ticket.movieTitle}</h3>
              <div className="muted" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
                {formatFullDateTime(ticket.scheduleStartTime)}
              </div>
              <div style={{ marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'space-between' }}>
                <span className="faint">Seats: {ticket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ')}</span>
                <b>${ticket.totalPrice.toFixed(2)}</b>
              </div>
            </div>
          )}

          <div className="btn-row" style={{ justifyContent: 'center', marginTop: 'var(--space-6)' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleTryAgain}
            >
              Try again
            </button>
            <Link to="/" className="btn btn-ghost">
              Browse other movies
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
