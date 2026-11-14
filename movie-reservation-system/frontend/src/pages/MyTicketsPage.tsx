import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';
import { TicketCard } from '../components/TicketCard';
import type { TicketDto } from '../types/ticket';
import * as ticketsApi from '../api/ticketsApi';
import { useAuth } from '../context/useAuth';
import { formatDateShort, formatTime, formatFullDateTime } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

type TicketFilter = 'upcoming' | 'past' | 'cancelled';

export function MyTicketsPage(): React.JSX.Element {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [filter, setFilter] = useState<TicketFilter>('upcoming');
  const [loading, setLoading] = useState<boolean>(() => !!user);
  const [error, setError] = useState<string | null>(null);

  // Cancellation state
  const [ticketToCancel, setTicketToCancel] = useState<TicketDto | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // Voucher modal state
  const [voucherTicket, setVoucherTicket] = useState<TicketDto | null>(null);

  // Pure timestamp captured at mount
  const [referenceTime] = useState<number>(() => Date.now());

  useEffect(() => {
    let ignore = false;
    if (user) {
      ticketsApi
        .getMyTickets(0, 50)
        .then((res) => {
          if (!ignore) {
            setTickets(res.content);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            setError(err instanceof Error ? err.message : 'Failed to load your tickets.');
            setLoading(false);
          }
        });
    }

    return () => {
      ignore = true;
    };
  }, [user]);

  const reloadTickets = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await ticketsApi.getMyTickets(0, 50);
      setTickets(res.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your tickets.');
    } finally {
      setLoading(false);
    }
  };

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const showtime = new Date(t.scheduleStartTime).getTime();
      const isCancelledOrRefunded = t.status === 'CANCELLED' || t.status === 'REFUNDED' || t.status === 'EXPIRED';

      if (filter === 'cancelled') {
        return isCancelledOrRefunded;
      }
      if (filter === 'upcoming') {
        return !isCancelledOrRefunded && showtime >= referenceTime;
      }
      if (filter === 'past') {
        return !isCancelledOrRefunded && showtime < referenceTime;
      }
      return true;
    });
  }, [tickets, filter, referenceTime]);

  const handleConfirmCancel = async () => {
    if (!ticketToCancel) return;
    try {
      setCancellingId(ticketToCancel.id);
      await ticketsApi.cancelTicket(ticketToCancel.id);
      setTicketToCancel(null);
      await reloadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel ticket.');
    } finally {
      setCancellingId(null);
    }
  };

  const upcomingCount = useMemo(() => {
    return tickets.filter((t) => {
      const showtime = new Date(t.scheduleStartTime).getTime();
      return (t.status === 'PAID' || t.status === 'PENDING_PAYMENT') && showtime >= referenceTime;
    }).length;
  }, [tickets, referenceTime]);

  const cancelledCount = useMemo(() => {
    return tickets.filter((t) => t.status === 'CANCELLED' || t.status === 'REFUNDED' || t.status === 'EXPIRED').length;
  }, [tickets]);

  if (!user) {
    return (
      <div className="screen-container">
        <TopBar />
        <main className="wrap">
          <div style={{ maxWidth: '500px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
            <h1>My tickets</h1>
            <p className="muted" style={{ margin: 'var(--space-4) 0 var(--space-6)' }}>
              Please sign in to view your tickets and booking history.
            </p>
            <Link to="/login?return=/tickets" className="btn btn-primary">
              Sign in to CineBook
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="screen-container">
      <TopBar />

      <main className="wrap">
        <h1>My tickets</h1>

        {error && (
          <div className="error-banner" style={{ marginTop: 'var(--space-4)' }} role="alert">
            {error}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="btn-row" style={{ marginTop: 'var(--space-6)', maxWidth: '500px' }} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'upcoming'}
            className={`chip ${filter === 'upcoming' ? 'on' : ''}`}
            onClick={() => setFilter('upcoming')}
          >
            Upcoming · {upcomingCount}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'past'}
            className={`chip ${filter === 'past' ? 'on' : ''}`}
            onClick={() => setFilter('past')}
          >
            Past
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'cancelled'}
            className={`chip ${filter === 'cancelled' ? 'on' : ''}`}
            onClick={() => setFilter('cancelled')}
          >
            Cancelled &amp; refunded · {cancelledCount}
          </button>
        </div>

        {/* Tickets List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
          {loading ? (
            <>
              <div className="skeleton" style={{ height: '140px', borderRadius: 'var(--radius-lg)' }} />
              <div className="skeleton" style={{ height: '140px', borderRadius: 'var(--radius-lg)' }} />
            </>
          ) : filteredTickets.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 'var(--space-12) 0',
                background: 'var(--panel)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--line)',
                marginTop: 'var(--space-4)',
              }}
            >
              <h3 style={{ color: 'var(--ink-soft)' }}>No tickets found in this tab</h3>
              <p className="faint" style={{ marginTop: 'var(--space-2)' }}>
                {filter === 'upcoming'
                  ? 'You have no upcoming movie showtimes. Explore the schedule to book seats!'
                  : 'No tickets to display.'}
              </p>
              {filter === 'upcoming' && (
                <Link to="/" className="btn btn-primary" style={{ marginTop: 'var(--space-6)' }}>
                  Browse movies
                </Link>
              )}
            </div>
          ) : (
            filteredTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                isCancelling={cancellingId === ticket.id}
                onCancel={() => setTicketToCancel(ticket)}
                onViewVoucher={() => setVoucherTicket(ticket)}
              />
            ))
          )}
        </div>

        {/* Cancellation Confirmation Dialog */}
        {ticketToCancel && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(5, 6, 11, 0.8)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 100,
              padding: 'var(--space-4)',
            }}
            role="dialog"
            aria-labelledby="cancel-dialog-title"
          >
            <div className="form-card" style={{ maxWidth: '480px', margin: 0 }}>
              <h2 id="cancel-dialog-title">Cancel Ticket?</h2>
              <p className="muted" style={{ lineHeight: 1.6 }}>
                Are you sure you want to cancel your booking for <b>{ticketToCancel.movieTitle}</b>?
                {ticketToCancel.status === 'PAID' ? (
                  <>
                    <br />
                    A full refund of <b>${ticketToCancel.totalPrice.toFixed(2)}</b> will be issued to your payment card.
                  </>
                ) : (
                  <> Your held seats will be released immediately.</>
                )}
              </p>

              <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setTicketToCancel(null)}
                >
                  Keep ticket
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={cancellingId === ticketToCancel.id}
                  onClick={handleConfirmCancel}
                >
                  {cancellingId === ticketToCancel.id ? 'Cancelling...' : 'Confirm cancellation'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Voucher Modal */}
        {voucherTicket && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(5, 6, 11, 0.85)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 100,
              padding: 'var(--space-4)',
            }}
            role="dialog"
            aria-labelledby="voucher-title"
          >
            <div style={{ maxWidth: '520px', width: '100%' }}>
              <div className="ticket-voucher">
                <div className="t-top">
                  <div
                    className="poster"
                    style={{ background: getPosterGradient(voucherTicket.movieTitle) }}
                  >
                    <div className="ptitle" style={{ fontSize: '15px' }}>{voucherTicket.movieTitle}</div>
                  </div>

                  <div style={{ flex: 1 }}>
                    <span className="badge b-paid">● PAID</span>
                    <h2 id="voucher-title" style={{ marginTop: 'var(--space-2)', fontSize: '24px' }}>
                      {voucherTicket.movieTitle}
                    </h2>
                    <div className="t-grid">
                      <div>
                        <small>Date</small>
                        <b>{formatDateShort(voucherTicket.scheduleStartTime)}</b>
                      </div>
                      <div>
                        <small>Time</small>
                        <b>{formatTime(voucherTicket.scheduleStartTime)}</b>
                      </div>
                      <div>
                        <small>Seats</small>
                        <b>{voucherTicket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ')}</b>
                      </div>
                      <div>
                        <small>Paid</small>
                        <b>${voucherTicket.totalPrice.toFixed(2)}</b>
                      </div>
                      <div>
                        <small>Ticket #</small>
                        <b>#{voucherTicket.id}</b>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="perf" />

                <div className="t-bottom">
                  <div>
                    <small className="faint" style={{ fontSize: '12px', fontWeight: 750, letterSpacing: '0.08em' }}>
                      SHOW AT ENTRANCE
                    </small>
                    <div style={{ fontSize: '15px', fontWeight: 700, marginTop: 'var(--space-1)', letterSpacing: '0.05em' }}>
                      CB-{voucherTicket.id}-{voucherTicket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join('')}
                    </div>
                  </div>
                  <div className="faint" style={{ fontSize: '12px' }}>
                    {formatFullDateTime(voucherTicket.scheduleStartTime)}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setVoucherTicket(null)}
                >
                  Close voucher
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
