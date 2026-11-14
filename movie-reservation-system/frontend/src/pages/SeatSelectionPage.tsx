import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { SeatGrid } from '../components/SeatGrid';
import { HoldTimer } from '../components/HoldTimer';
import type { ScheduleDto } from '../types/schedule';
import type { SeatDto } from '../types/seat';
import * as schedulesApi from '../api/schedulesApi';
import * as seatsApi from '../api/seatsApi';
import * as ticketsApi from '../api/ticketsApi';
import { ApiException } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatFullDateTime } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

const MAX_SEATS_PER_USER = 8;
const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';
const SAVED_SEATS_KEY = 'cinebook_saved_seats';

export function SeatSelectionPage(): React.JSX.Element {
  const { scheduleId: paramScheduleId } = useParams<{ scheduleId: string }>();
  const scheduleId = Number(paramScheduleId);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [schedule, setSchedule] = useState<ScheduleDto | null>(null);
  const [seats, setSeats] = useState<SeatDto[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<number>>(new Set());
  const [heldExpiresAt, setHeldExpiresAt] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    if (!scheduleId) return;

    Promise.all([
      schedulesApi.getSchedule(scheduleId),
      seatsApi.getSeatMap(scheduleId),
    ])
      .then(([schedData, mapData]) => {
        if (!ignore) {
          setSchedule(schedData);
          setSeats(mapData.seats);
          setLoading(false);

          // Restore previously saved seats if returned from sign-in
          try {
            const savedRaw = sessionStorage.getItem(SAVED_SEATS_KEY);
            if (savedRaw) {
              const parsed = JSON.parse(savedRaw);
              if (parsed.scheduleId === scheduleId && Array.isArray(parsed.seatIds)) {
                setSelectedSeatIds(new Set(parsed.seatIds));
              }
              sessionStorage.removeItem(SAVED_SEATS_KEY);
            }
          } catch {
            // Ignore storage parse issues
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load seats');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [scheduleId]);

  const reloadSeatMap = async () => {
    try {
      const mapData = await seatsApi.getSeatMap(scheduleId);
      setSeats(mapData.seats);
    } catch {
      // Ignore
    }
  };

  // Toggle seat selection
  const handleToggleSeat = (seat: SeatDto) => {
    setError(null);
    setInfoMessage(null);

    setSelectedSeatIds((prev) => {
      const next = new Set(prev);
      if (next.has(seat.seatId)) {
        next.delete(seat.seatId);
      } else {
        if (next.size >= MAX_SEATS_PER_USER) {
          setInfoMessage(`You can hold a maximum of ${MAX_SEATS_PER_USER} seats per showtime.`);
          return prev;
        }
        next.add(seat.seatId);
      }
      return next;
    });
  };

  // Selected seat models
  const selectedSeats = useMemo(() => {
    return seats.filter((s) => selectedSeatIds.has(s.seatId));
  }, [seats, selectedSeatIds]);

  const totalPrice = useMemo(() => {
    return selectedSeats.reduce((sum, s) => sum + s.price, 0);
  }, [selectedSeats]);

  // Handle countdown expiry
  const handleHoldExpired = () => {
    setHeldExpiresAt(null);
    setSelectedSeatIds(new Set());
    setError('Your seat hold expired and the seats were released. Please select your seats again.');
    void reloadSeatMap();
  };

  // Hold & Proceed to checkout
  const handleProceed = async () => {
    if (selectedSeatIds.size === 0) {
      setError('Please select at least one seat to continue.');
      return;
    }

    // Guest checkout check
    if (!user) {
      try {
        sessionStorage.setItem(
          SAVED_SEATS_KEY,
          JSON.stringify({ scheduleId, seatIds: Array.from(selectedSeatIds) }),
        );
      } catch {
        // Storage error
      }
      navigate(`/login?return=/book/${scheduleId}`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Step 1: Hold seats if not already held with active countdown
      if (!heldExpiresAt) {
        const holdRes = await seatsApi.holdSeats(scheduleId, Array.from(selectedSeatIds));
        setHeldExpiresAt(holdRes.expiresAt);
      }

      // Step 2: Checkout ticket via Stripe gateway
      const ticketRes = await ticketsApi.checkoutTicket(scheduleId);
      sessionStorage.setItem(PENDING_TICKET_KEY, String(ticketRes.ticketId));

      if (ticketRes.checkoutUrl) {
        window.location.href = ticketRes.checkoutUrl;
      } else {
        navigate(`/payment/success`);
      }
    } catch (err) {
      if (err instanceof ApiException && err.status === 503) {
        setError(
          'Online payment is currently unavailable (Stripe payment gateway is not configured). Your held seats are preserved.',
        );
      } else if (err instanceof ApiException && err.status === 409) {
        setError('One or more of your selected seats were just taken. Refreshing available seats...');
        void reloadSeatMap();
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred during checkout.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="screen-container">
        <main className="wrap">
          <div className="skeleton" style={{ height: '500px', borderRadius: 'var(--radius-xl)' }} />
        </main>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="screen-container">
        <main className="wrap">
          <div className="error-banner">{error || 'Showtime not found'}</div>
        </main>
      </div>
    );
  }

  const gradient = getPosterGradient(schedule.movie.title || schedule.id);

  return (
    <div className="screen-container">
      {/* Top Bar with Steps */}
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
          <span className="cur" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">2</span>
            Seats
          </span>
          <span className="bar" aria-hidden="true" />
          <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">3</span>
            Payment
          </span>
          <span className="bar" aria-hidden="true" />
          <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="dot" aria-hidden="true">4</span>
            Ticket
          </span>
        </div>
      </header>

      <main className="wrap">
        <h1>Choose your seats</h1>
        <p className="muted" style={{ marginTop: 'var(--space-1)', fontSize: '15px' }}>
          {schedule.movie.title} · {schedule.theater.name} · {formatFullDateTime(schedule.startTime)} · up to {MAX_SEATS_PER_USER} seats per person
        </p>

        {error && (
          <div className="error-banner" style={{ marginTop: 'var(--space-4)' }} role="alert">
            {error}
          </div>
        )}

        {infoMessage && (
          <div
            style={{
              marginTop: 'var(--space-4)',
              background: 'rgba(255, 181, 71, 0.1)',
              border: '1px solid var(--amber)',
              color: 'var(--amber)',
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
            }}
            role="status"
          >
            {infoMessage}
          </div>
        )}

        <div className="seat-layout">
          {/* Seat Grid Component */}
          <SeatGrid
            seats={seats}
            selectedSeatIds={selectedSeatIds}
            onToggleSeat={handleToggleSeat}
            maxSeatsReached={selectedSeatIds.size >= MAX_SEATS_PER_USER}
          />

          {/* Booking Summary Sidebar */}
          <aside className="summary-card" aria-label="Booking summary">
            <div className="sum-movie">
              <div
                className="poster"
                style={{
                  background: schedule.movie.posterUrl
                    ? `url(${schedule.movie.posterUrl})`
                    : gradient,
                }}
              >
                {!schedule.movie.posterUrl && (
                  <div className="ptitle" style={{ fontSize: '11px' }}>
                    {schedule.movie.title}
                  </div>
                )}
              </div>
              <div>
                <h2 style={{ fontSize: '19px' }}>{schedule.movie.title}</h2>
                <div className="muted" style={{ fontSize: '13px', marginTop: 'var(--space-1)', lineHeight: 1.5 }}>
                  {formatFullDateTime(schedule.startTime)}
                  <br />
                  {schedule.theater.name}
                </div>
              </div>
            </div>

            {/* Selected Seats List */}
            <div style={{ minHeight: '60px' }}>
              {selectedSeats.length === 0 ? (
                <div className="faint" style={{ fontSize: '14px', fontStyle: 'italic', padding: 'var(--space-3) 0' }}>
                  No seats selected yet. Click any available seat in the map.
                </div>
              ) : (
                selectedSeats.map((s) => (
                  <div key={s.seatId} className="line-item">
                    <span>
                      Seat {s.rowLabel}{s.seatNumber} · {s.type === 'VIP' ? 'VIP' : 'Standard'}
                    </span>
                    <b>${s.price.toFixed(2)}</b>
                  </div>
                ))
              )}
            </div>

            {/* Total */}
            <div className="total-row">
              <span className="muted">
                Total · {selectedSeats.length} {selectedSeats.length === 1 ? 'seat' : 'seats'}
              </span>
              <b>${totalPrice.toFixed(2)}</b>
            </div>

            {/* Hold Timer */}
            {heldExpiresAt && (
              <HoldTimer
                expiresAt={heldExpiresAt}
                onExpire={handleHoldExpired}
              />
            )}

            {/* Continue Button */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedSeats.length === 0 || isSubmitting}
              onClick={handleProceed}
              style={{ width: '100%' }}
            >
              {isSubmitting
                ? 'Processing...'
                : user
                ? 'Continue to secure payment'
                : 'Sign in to reserve seats'}
            </button>

            <div className="stripe-badge">
              Secure checkout by <b>stripe</b>
              <br />
              Your card details never touch our servers
            </div>

            <p className="faint" style={{ fontSize: '12px', lineHeight: 1.5 }}>
              Free cancellation with a full refund until 2 hours before the showtime.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
