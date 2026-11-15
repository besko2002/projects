import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { SeatGrid } from '../components/SeatGrid';
import { HoldTimer } from '../components/HoldTimer';
import type { ScheduleDto } from '../types/schedule';
import type { SeatDto, SeatReservationDto } from '../types/seat';
import * as schedulesApi from '../api/schedulesApi';
import * as seatsApi from '../api/seatsApi';
import * as ticketsApi from '../api/ticketsApi';
import { ApiException } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatFullDateTime } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

const MAX_SEATS_PER_USER = 8;
const PENDING_TICKET_KEY = 'cinebook_pending_ticket_id';
const SAVED_SEATS_KEY = 'cinebook_saved_seats';

export function SeatSelectionPage(): React.JSX.Element {
  const { scheduleId: paramScheduleId } = useParams<{ scheduleId: string }>();
  const scheduleId = Number(paramScheduleId);
  const isInvalidId = !Number.isInteger(scheduleId) || scheduleId <= 0;

  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const [schedule, setSchedule] = useState<ScheduleDto | null>(null);
  const [seats, setSeats] = useState<SeatDto[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<number>>(new Set());

  // Holds map: seatId -> SeatReservationDto (P1-1)
  const [heldReservations, setHeldReservations] = useState<Map<number, SeatReservationDto>>(
    new Map(),
  );
  const [heldExpiresAt, setHeldExpiresAt] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(!isInvalidId);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(
    isInvalidId ? 'Showtime not found.' : null,
  );
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Ref to track holds for cleanup on unmount if no ticket was created (P1-1)
  const ticketCreatedRef = useRef<boolean>(false);
  const heldReservationsRef = useRef<Map<number, SeatReservationDto>>(heldReservations);
  useEffect(() => {
    heldReservationsRef.current = heldReservations;
  }, [heldReservations]);

  // Load schedule and seat map
  useEffect(() => {
    let ignore = false;
    if (isInvalidId) return;

    Promise.all([
      schedulesApi.getSchedule(scheduleId),
      seatsApi.getSeatMap(scheduleId),
    ])
      .then(([schedData, mapData]) => {
        if (!ignore) {
          setSchedule(schedData);
          setSeats(mapData.seats);
          setLoading(false);

          // Restore previously saved seats from registration / login redirect
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
            // Storage parse issue ignored
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Showtime not found');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [scheduleId, isInvalidId]);

  // Load existing user holds for this showtime (P1-1)
  useEffect(() => {
    let ignore = false;
    if (isInvalidId || !user) return;

    seatsApi
      .getMyReservations()
      .then((reservations) => {
        if (!ignore) {
          const activeHolds = reservations.filter(
            (r) => r.scheduleId === scheduleId && r.status === 'HELD',
          );

          if (activeHolds.length > 0) {
            const map = new Map<number, SeatReservationDto>();
            let earliestExpiry: number | null = null;

            for (const h of activeHolds) {
              map.set(h.seatId, h);
              if (h.expiresAt) {
                const expTime = new Date(h.expiresAt).getTime();
                if (earliestExpiry === null || expTime < earliestExpiry) {
                  earliestExpiry = expTime;
                }
              }
            }

            setHeldReservations(map);
            setSelectedSeatIds((prev) => {
              const next = new Set(prev);
              for (const seatId of map.keys()) {
                next.add(seatId);
              }
              return next;
            });

            if (earliestExpiry !== null) {
              setHeldExpiresAt(new Date(earliestExpiry).toISOString());
            }
          }
        }
      })
      .catch(() => {
        // Non-blocking if fails
      });

    return () => {
      ignore = true;
    };
  }, [scheduleId, user, isInvalidId]);

  // Cleanup on unmount: release active holds if no ticket was created (P1-1, P3: don't print "Released null")
  useEffect(() => {
    return () => {
      if (!ticketCreatedRef.current) {
        const toRelease = Array.from(heldReservationsRef.current.values());
        for (const res of toRelease) {
          if (res && res.id) {
            void seatsApi.releaseReservation(res.id).catch(() => {});
          }
        }
      }
    };
  }, []);

  const reloadSeatMap = async () => {
    try {
      const mapData = await seatsApi.getSeatMap(scheduleId);
      setSeats(mapData.seats);
    } catch {
      // Ignore
    }
  };

  // Toggle seat selection (P1-1: release deselected ones immediately)
  const handleToggleSeat = async (seat: SeatDto) => {
    setError(null);
    setInfoMessage(null);

    const isCurrentlySelected = selectedSeatIds.has(seat.seatId);

    if (isCurrentlySelected) {
      // If seat is currently held by this user, release it on the backend (P1-1)
      const existingRes = heldReservations.get(seat.seatId);
      if (existingRes && existingRes.id) {
        try {
          await seatsApi.releaseReservation(existingRes.id);
          setHeldReservations((prev) => {
            const next = new Map(prev);
            next.delete(seat.seatId);
            return next;
          });
        } catch {
          // If already released, proceed
        }
      }

      setSelectedSeatIds((prev) => {
        const next = new Set(prev);
        next.delete(seat.seatId);
        if (next.size === 0) {
          setHeldExpiresAt(null);
        }
        return next;
      });
      void reloadSeatMap();
    } else {
      // Compute remaining allowance: 8 minus active reservations (P2-5)
      const activeResCount = heldReservations.size;
      const unheldSelectedCount = Array.from(selectedSeatIds).filter(
        (id) => !heldReservations.has(id),
      ).length;

      if (activeResCount + unheldSelectedCount >= MAX_SEATS_PER_USER) {
        setInfoMessage(
          `You can hold a maximum of ${MAX_SEATS_PER_USER} seats per showtime (remaining allowance: ${Math.max(
            0,
            MAX_SEATS_PER_USER - activeResCount,
          )}).`,
        );
        return;
      }

      setSelectedSeatIds((prev) => {
        const next = new Set(prev);
        next.add(seat.seatId);
        return next;
      });
    }
  };

  // Build selected seat models
  const selectedSeats = useMemo(() => {
    return seats.filter((s) => selectedSeatIds.has(s.seatId));
  }, [seats, selectedSeatIds]);

  // Total price: sync from held reservations when available, else sum selected (P1-2)
  const totalPrice = useMemo(() => {
    let sum = 0;
    for (const seat of selectedSeats) {
      const held = heldReservations.get(seat.seatId);
      sum += held ? Number(held.price) : Number(seat.price);
    }
    return sum;
  }, [selectedSeats, heldReservations]);

  // Countdown expiry handler (P1-1)
  const handleHoldExpired = () => {
    setHeldExpiresAt(null);
    setHeldReservations(new Map());
    setSelectedSeatIds(new Set());
    setError('Your seat hold expired and the seats were released. Please select your seats again.');
    void reloadSeatMap();
  };

  // Proceed to payment (P1-1, P1-2, P2-5)
  const handleProceed = async () => {
    if (selectedSeatIds.size === 0) {
      setError('Please select at least one seat to continue.');
      return;
    }

    // Guest checkout redirect: save selection for return
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

      // Step 1: Hold any newly selected seats not yet held by this user (P1-2)
      const unheldSeatIds = Array.from(selectedSeatIds).filter(
        (id) => !heldReservations.has(id),
      );

      if (unheldSeatIds.length > 0) {
        const holdRes = await seatsApi.holdSeats(scheduleId, unheldSeatIds);
        setHeldExpiresAt(holdRes.expiresAt);

        // Update heldReservations map
        setHeldReservations((prev) => {
          const next = new Map(prev);
          for (const item of holdRes.seats) {
            next.set(item.seatId, {
              id: item.reservationId,
              scheduleId,
              seatId: item.seatId,
              ticketId: null,
              price: item.price,
              status: 'HELD',
              expiresAt: holdRes.expiresAt,
            });
          }
          return next;
        });
      }

      // Step 2: Checkout ticket via Stripe gateway (idempotent for current pending)
      const ticketRes = await ticketsApi.checkoutTicket(scheduleId);
      ticketCreatedRef.current = true;
      sessionStorage.setItem(PENDING_TICKET_KEY, String(ticketRes.ticketId));

      if (ticketRes.checkoutUrl) {
        window.location.href = ticketRes.checkoutUrl;
      } else {
        navigate('/payment/success');
      }
    } catch (err) {
      if (err instanceof ApiException && err.status === 503) {
        setError(
          'Online payment is currently unavailable (Stripe payment gateway is not configured). Your held seats are preserved.',
        );
      } else if (err instanceof ApiException && err.status === 409) {
        // P2-5: Show backend's actual error message for 409
        setError(err.message || 'One or more of your selected seats were just taken.');
        void reloadSeatMap();
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred during checkout.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isInvalidId || (!loading && !schedule && error)) {
    return (
      <div className="screen screen-container">
        <TopBar step={2} />
        <main className="wrap">
          <div className="error-banner" role="alert">
            {error || 'Showtime not found'}
          </div>
          <div style={{ marginTop: 'var(--space-6)' }}>
            <button type="button" className="btn" onClick={() => navigate('/')}>
              ← Back to movies
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (loading || authLoading || !schedule) {
    return (
      <div className="screen screen-container">
        <TopBar step={2} />
        <main className="wrap">
          <div className="skeleton" style={{ height: '520px', border: '3px solid var(--ink)' }} />
        </main>
      </div>
    );
  }

  const remainingAllowance = Math.max(0, MAX_SEATS_PER_USER - selectedSeatIds.size);

  return (
    <div className="screen screen-container" id="seats">
      <TopBar step={2} />

      <main className="wrap">
        <div className="kicker">
          {schedule.movie.title} · {schedule.theater.name} · {formatFullDateTime(schedule.startTime)}
        </div>
        <h1>Pick your seats</h1>

        {error && (
          <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {infoMessage && (
          <div
            className="info-banner"
            role="status"
            style={{
              marginTop: 'var(--space-4)',
              background: '#fff1c9',
              border: '2px solid var(--ink)',
              padding: 'var(--space-3) var(--space-4)',
              fontWeight: 700,
              fontSize: '14px',
            }}
          >
            {infoMessage}
          </div>
        )}

        <div className="seat-layout">
          {/* Outlined Seat Map Grid with Roving Tabindex */}
          <div className="hall-wrapper">
            <SeatGrid
              seats={seats}
              selectedSeatIds={selectedSeatIds}
              onToggleSeat={handleToggleSeat}
              maxSeatsReached={remainingAllowance === 0}
            />
          </div>

          {/* Dark "YOUR TICKETS" Summary Panel */}
          <aside className="summary" aria-label="Booking summary">
            <div className="head">
              <h2>Your tickets</h2>
            </div>

            <div className="body">
              <div style={{ minHeight: '60px' }}>
                {selectedSeats.length === 0 ? (
                  <p className="soft" style={{ fontSize: '14px', fontStyle: 'italic', padding: 'var(--space-2) 0' }}>
                    Click any available seat in the hall to select.
                  </p>
                ) : (
                  selectedSeats.map((s) => {
                    const held = heldReservations.get(s.seatId);
                    const seatPrice = held ? held.price : s.price;
                    return (
                      <div key={s.seatId} className="li">
                        <span>
                          {s.rowLabel}{s.seatNumber} · {s.type === 'VIP' ? 'VIP' : 'Standard'}
                        </span>
                        <b>{formatMoney(seatPrice)}</b>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Big Total */}
              <div className="total">
                <span>
                  Total · {selectedSeats.length} {selectedSeats.length === 1 ? 'seat' : 'seats'}
                </span>
                <b>{formatMoney(totalPrice)}</b>
              </div>

              {/* Hold Countdown Clock */}
              {heldExpiresAt && (
                <HoldTimer
                  expiresAt={heldExpiresAt}
                  onExpire={handleHoldExpired}
                />
              )}

              {/* Primary Action Button */}
              <button
                type="button"
                className="btn red"
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

              <p className="soft" style={{ fontSize: '13px', lineHeight: 1.5, textAlign: 'center' }}>
                Secure payment by Stripe · free cancellation until 2 hours before the show
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
