import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';
import { TicketCard } from '../components/TicketCard';
import type { TicketDto } from '../types/ticket';
import * as ticketsApi from '../api/ticketsApi';
import { useAuth } from '../context/useAuth';
import { formatDateShort, formatTime, formatFullDateTime } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

type TicketFilter = 'upcoming' | 'past' | 'cancelled';
const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';
const PAGE_SIZE = 10;

export function MyTicketsPage(): React.JSX.Element {
  const { user, isLoading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalElements, setTotalElements] = useState<number>(0);
  const [filter, setFilter] = useState<TicketFilter>('upcoming');
  const [loading, setLoading] = useState<boolean>(() => !user && !authLoading ? false : true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Cancellation state
  const [ticketToCancel, setTicketToCancel] = useState<TicketDto | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelDialogError, setCancelDialogError] = useState<string | null>(null); // P2-7

  // Voucher modal state
  const [voucherTicket, setVoucherTicket] = useState<TicketDto | null>(null);

  // Focus trap ref for dialogs (P3)
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reference timestamp
  const [referenceTime] = useState<number>(() => Date.now());

  // Escape key handler for dialogs (P3)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (ticketToCancel) setTicketToCancel(null);
        if (voucherTicket) setVoucherTicket(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ticketToCancel, voucherTicket]);

  // Focus trap handler (P3)
  useEffect(() => {
    if (ticketToCancel || voucherTicket) {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      }

      const trap = (e: KeyboardEvent) => {
        if (e.key !== 'Tab' || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };

      dialog.addEventListener('keydown', trap);
      return () => dialog.removeEventListener('keydown', trap);
    }
  }, [ticketToCancel, voucherTicket]);

  const loadTickets = async (page: number) => {
    try {
      setPageError(null);
      const res = await ticketsApi.getMyTickets(page, PAGE_SIZE);
      setTickets(res.content);
      setTotalPages(res.totalPages || 1);
      setTotalElements(res.totalElements || res.content.length);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to load your tickets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    if (user) {
      ticketsApi
        .getMyTickets(currentPage, PAGE_SIZE)
        .then((res) => {
          if (!ignore) {
            setTickets(res.content);
            setTotalPages(res.totalPages || 1);
            setTotalElements(res.totalElements || res.content.length);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            setPageError(err instanceof Error ? err.message : 'Failed to load your tickets.');
            setLoading(false);
          }
        });
    }

    return () => {
      ignore = true;
    };
  }, [user, currentPage]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const showtime = new Date(t.scheduleStartTime).getTime();
      const isCancelledOrRefunded =
        t.status === 'CANCELLED' || t.status === 'REFUNDED' || t.status === 'EXPIRED';

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

  // Complete payment: POST /api/tickets {scheduleId} (idempotent), store ticketId, redirect (P1-3)
  const handlePayTicket = async (ticket: TicketDto) => {
    try {
      setPageError(null);
      const checkoutRes = await ticketsApi.checkoutTicket(ticket.scheduleId);
      sessionStorage.setItem(PENDING_TICKET_KEY, String(checkoutRes.ticketId));

      if (checkoutRes.checkoutUrl) {
        window.location.href = checkoutRes.checkoutUrl;
      } else {
        window.location.href = '/payment/success';
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to resume payment session.');
    }
  };

  // Confirm cancellation: show error inside dialog (P2-7)
  const handleConfirmCancel = async () => {
    if (!ticketToCancel) return;
    try {
      setCancellingId(ticketToCancel.id);
      setCancelDialogError(null);
      await ticketsApi.cancelTicket(ticketToCancel.id);

      // Clear pending ticket storage if this ticket was pending
      try {
        const stored = sessionStorage.getItem(PENDING_TICKET_KEY);
        if (stored === String(ticketToCancel.id)) {
          sessionStorage.removeItem(PENDING_TICKET_KEY);
        }
      } catch {
        // Ignore
      }

      setTicketToCancel(null);
      await loadTickets(currentPage);
    } catch (err) {
      // P2-7: Show error inside the dialog instead of closing
      setCancelDialogError(err instanceof Error ? err.message : 'Cancellation failed.');
    } finally {
      setCancellingId(null);
    }
  };

  // Respect authLoading (P3)
  if (authLoading) {
    return (
      <div className="screen screen-container">
        <TopBar />
        <main className="wrap">
          <div className="skeleton" style={{ height: '400px', border: '3px solid var(--ink)' }} />
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="screen screen-container">
        <TopBar />
        <main className="wrap">
          <div
            style={{
              maxWidth: '540px',
              margin: 'var(--space-8) auto',
              textAlign: 'center',
              border: '3px solid var(--ink)',
              background: 'var(--paper)',
              boxShadow: 'var(--shadow)',
              padding: 'var(--space-8) var(--space-6)',
            }}
          >
            <div className="kicker">Account Required</div>
            <h1 style={{ marginTop: 'var(--space-2)' }}>My tickets</h1>
            <p className="soft" style={{ margin: 'var(--space-4) 0 var(--space-6)', lineHeight: 1.6 }}>
              Please sign in to view your bookings, active seat holds, and refund history.
            </p>
            <Link to="/login?return=/tickets" className="btn red">
              Sign in to CineBook
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="screen screen-container">
      <TopBar />

      <main className="wrap">
        <div className="kicker">Customer Account</div>
        <h1>My tickets</h1>

        {pageError && (
          <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {pageError}
          </div>
        )}

        {/* Filter Buttons in Retro Style */}
        <div
          className="controls"
          style={{ marginTop: 'var(--space-6)', justifyContent: 'flex-start' }}
        >
          <div className="genres">
            <button
              type="button"
              aria-pressed={filter === 'upcoming'}
              className={`tag ${filter === 'upcoming' ? 'on' : ''}`}
              onClick={() => setFilter('upcoming')}
            >
              Upcoming showtimes
            </button>
            <button
              type="button"
              aria-pressed={filter === 'past'}
              className={`tag ${filter === 'past' ? 'on' : ''}`}
              onClick={() => setFilter('past')}
            >
              Past showtimes
            </button>
            <button
              type="button"
              aria-pressed={filter === 'cancelled'}
              className={`tag ${filter === 'cancelled' ? 'on' : ''}`}
              onClick={() => setFilter('cancelled')}
            >
              Cancelled &amp; refunded
            </button>
          </div>
        </div>

        {/* Tickets List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
          {loading ? (
            <>
              <div className="skeleton" style={{ height: '140px', border: '3px solid var(--ink)' }} />
              <div className="skeleton" style={{ height: '140px', border: '3px solid var(--ink)' }} />
            </>
          ) : filteredTickets.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 'var(--space-12) var(--space-6)',
                background: 'var(--paper)',
                border: '3px solid var(--ink)',
                boxShadow: 'var(--shadow)',
                marginTop: 'var(--space-4)',
              }}
            >
              <h2>No tickets found in this section</h2>
              <p className="soft" style={{ marginTop: 'var(--space-2)' }}>
                {filter === 'upcoming'
                  ? 'You have no upcoming movie showtimes. Explore the schedule to book seats!'
                  : 'No tickets to display.'}
              </p>
              {filter === 'upcoming' && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                  <Link to="/" className="btn red">
                    Browse movies
                  </Link>
                </div>
              )}
            </div>
          ) : (
            filteredTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                isCancelling={cancellingId === ticket.id}
                onCancel={() => {
                  setCancelDialogError(null);
                  setTicketToCancel(ticket);
                }}
                onPay={handlePayTicket}
                onViewVoucher={() => setVoucherTicket(ticket)}
              />
            ))
          )}
        </div>

        {/* Pagination Controls (P3) */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-8)',
            }}
            aria-label="Ticket pagination"
          >
            <button
              type="button"
              className="btn btn-compact"
              disabled={currentPage === 0 || loading}
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              aria-label="Previous page"
            >
              ← Previous
            </button>
            <span className="soft" style={{ fontWeight: 800, fontSize: '13px' }}>
              Page {currentPage + 1} of {totalPages} ({totalElements} tickets)
            </span>
            <button
              type="button"
              className="btn btn-compact"
              disabled={currentPage >= totalPages - 1 || loading}
              onClick={() => setCurrentPage((p) => p + 1)}
              aria-label="Next page"
            >
              Next →
            </button>
          </div>
        )}

        {/* Cancellation Confirmation Dialog (P2-7, P3: aria-modal, focus trap, Escape) */}
        {ticketToCancel && (
          <div
            className="modal-backdrop"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(34, 26, 20, 0.75)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 100,
              padding: 'var(--space-4)',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-title"
          >
            <div
              ref={dialogRef}
              className="form-card"
              style={{
                maxWidth: '500px',
                margin: 0,
                background: 'var(--paper)',
                border: '3px solid var(--ink)',
                boxShadow: 'var(--shadow)',
                padding: 'var(--space-6)',
              }}
            >
              <h2 id="cancel-dialog-title">Cancel Ticket?</h2>
              <p className="soft" style={{ marginTop: 'var(--space-2)', lineHeight: 1.6 }}>
                Are you sure you want to cancel your booking for <b>{ticketToCancel.movieTitle}</b>?
                {ticketToCancel.status === 'PAID' ? (
                  <>
                    <br />
                    A full refund of <b>{formatMoney(ticketToCancel.totalPrice, ticketToCancel.currency)}</b> will be issued to your payment card.
                  </>
                ) : (
                  <> Your held seats will be released immediately.</>
                )}
              </p>

              {/* Error displayed directly inside dialog (P2-7) */}
              {cancelDialogError && (
                <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-3)' }}>
                  {cancelDialogError}
                </div>
              )}

              <div className="acts" style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setTicketToCancel(null)}
                >
                  Keep ticket
                </button>
                <button
                  type="button"
                  className="btn red"
                  disabled={cancellingId === ticketToCancel.id}
                  onClick={handleConfirmCancel}
                >
                  {cancellingId === ticketToCancel.id ? 'Cancelling...' : 'Confirm cancellation'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Voucher Modal (P3: aria-modal, focus trap, Escape) */}
        {voucherTicket && (
          <div
            className="modal-backdrop"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(34, 26, 20, 0.75)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 100,
              padding: 'var(--space-4)',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voucher-dialog-title"
          >
            <div
              ref={dialogRef}
              style={{
                maxWidth: '480px',
                width: '100%',
                background: 'var(--paper)',
                border: '3px solid var(--ink)',
                boxShadow: 'var(--shadow)',
              }}
            >
              <div className="poster p2" style={{ height: '140px', position: 'relative' }}>
                <span className="stamp">● {voucherTicket.status}</span>
                <b id="voucher-dialog-title" style={{ fontSize: '32px' }}>
                  {voucherTicket.movieTitle}
                </b>
              </div>

              <div className="perf" aria-hidden="true" />

              <div className="stub" style={{ padding: 'var(--space-6)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', fontSize: '14px' }}>
                  <div>
                    <span className="soft">DATE</span>
                    <div><b>{formatDateShort(voucherTicket.scheduleStartTime)}</b></div>
                  </div>
                  <div>
                    <span className="soft">TIME</span>
                    <div><b>{formatTime(voucherTicket.scheduleStartTime)}</b></div>
                  </div>
                  <div>
                    <span className="soft">SEATS</span>
                    <div><b>{voucherTicket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(' · ')}</b></div>
                  </div>
                  <div>
                    <span className="soft">TOTAL</span>
                    <div><b>{formatMoney(voucherTicket.totalPrice, voucherTicket.currency)}</b></div>
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
                    CB-{voucherTicket.id}-{voucherTicket.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join('')}
                  </div>
                  <div className="soft" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}>
                    {formatFullDateTime(voucherTicket.scheduleStartTime)}
                  </div>
                </div>

                <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn red"
                    style={{ width: '100%' }}
                    onClick={() => setVoucherTicket(null)}
                  >
                    Close voucher
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
