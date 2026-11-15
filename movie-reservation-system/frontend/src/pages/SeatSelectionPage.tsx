import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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

  // Holds map: seatId -> SeatReservationDto
  const [heldReservations, setHeldReservations] = useState<Map<number, SeatReservationDto>>(
    new Map(),
  );
  const [confirmedSeats, setConfirmedSeats] = useState<SeatReservationDto[]>([]);
  const [pendingTicketId, setPendingTicketId] = useState<number | null>(null);
  const [heldExpiresAt, setHeldExpiresAt] = useState<string | null>(null);

  // Loading & ownership reconciliation (Issue 2)
  const [baseLoading, setBaseLoading] = useState<boolean>(!isInvalidId);
  const [ownershipLoaded, setOwnershipLoaded] = useState<boolean>(false);
  const [ownershipError, setOwnershipError] = useState<string | null>(null);

  const isOwnershipReady = !user || ownershipLoaded;

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(
    isInvalidId ? 'Showtime not found.' : null,
  );
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Lifecycle & submission race protection (Issue 3)
  const isMountedRef = useRef<boolean>(true);
  const submissionIdRef = useRef<number>(0);
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
          setSeats(mapData?.seats || []);
          setBaseLoading(false);

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
          setBaseLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [scheduleId, isInvalidId]);

  const reloadSeatMap = useCallback(async () => {
    try {
      const mapData = await seatsApi.getSeatMap(scheduleId);
      if (isMountedRef.current) {
        setSeats(mapData?.seats || []);
      }
    } catch {
      // Ignore map reload error
    }
  }, [scheduleId]);

  // Reconcile and apply user reservations, existing pending tickets, and expiries (Issues 1, 2, 4)
  const applyReconciledReservations = useCallback(
    (reservations: SeatReservationDto[], isExpiryEvent = false) => {
      const now = Date.now();
      const confirmed = reservations.filter(
        (r) => r.scheduleId === scheduleId && r.status === 'CONFIRMED',
      );
      const activeHolds = reservations.filter(
        (r) =>
          r.scheduleId === scheduleId &&
          r.status === 'HELD' &&
          new Date(r.expiresAt).getTime() > now,
      );

      setConfirmedSeats(confirmed);

      const map = new Map<number, SeatReservationDto>();
      let earliestExpiry: number | null = null;
      let foundTicketId: number | null = null;

      for (const h of activeHolds) {
        map.set(h.seatId, h);
        if (h.ticketId != null) {
          foundTicketId = h.ticketId;
        }
        if (h.expiresAt) {
          const expTime = new Date(h.expiresAt).getTime();
          if (earliestExpiry === null || expTime < earliestExpiry) {
            earliestExpiry = expTime;
          }
        }
      }

      setHeldReservations(map);
      setPendingTicketId(foundTicketId);

      // Reconcile selectedSeatIds:
      // Drop any previously held seats that are no longer valid on the server;
      // Keep non-server selections and valid active holds.
      setSelectedSeatIds((prev) => {
        const next = new Set<number>();
        for (const id of prev) {
          if (heldReservationsRef.current.has(id)) {
            if (map.has(id)) next.add(id);
          } else {
            next.add(id);
          }
        }
        for (const seatId of map.keys()) {
          next.add(seatId);
        }
        return next;
      });

      const hadPreviousHolds = heldReservationsRef.current.size > 0;
      const lostHolds = Array.from(heldReservationsRef.current.keys()).some(
        (id) => !map.has(id),
      );

      if (earliestExpiry !== null) {
        setHeldExpiresAt(new Date(earliestExpiry).toISOString());
        if (isExpiryEvent || lostHolds) {
          setError('One or more seat holds expired. Your remaining valid holds are kept.');
        }
      } else {
        setHeldExpiresAt(null);
        if (isExpiryEvent || (hadPreviousHolds && lostHolds)) {
          setError(
            'Your seat holds expired and the seats were released. Please select your seats again.',
          );
        }
      }

      setOwnershipLoaded(true);
      setOwnershipError(null);
      void reloadSeatMap();
    },
    [scheduleId, reloadSeatMap],
  );

  const reconcileReservations = useCallback(
    async (isExpiryEvent = false) => {
      if (!isMountedRef.current || isInvalidId || authLoading || !user) return;

      try {
        const reservations = await seatsApi.getMyReservations();
        if (!isMountedRef.current) return;
        applyReconciledReservations(reservations, isExpiryEvent);
      } catch (err) {
        if (!isMountedRef.current) return;
        setOwnershipLoaded(false);
        setOwnershipError(
          err instanceof Error
            ? err.message
            : 'Failed to verify existing seat reservations. Please retry.',
        );
        if (isExpiryEvent) {
          setHeldExpiresAt(null);
        }
        void reloadSeatMap();
      }
    },
    [authLoading, isInvalidId, user, applyReconciledReservations, reloadSeatMap],
  );

  useEffect(() => {
    let ignore = false;
    if (isInvalidId || authLoading || !user) return;

    seatsApi
      .getMyReservations()
      .then((reservations) => {
        if (!ignore && isMountedRef.current) {
          applyReconciledReservations(reservations, false);
        }
      })
      .catch((err) => {
        if (!ignore && isMountedRef.current) {
          setOwnershipLoaded(false);
          setOwnershipError(
            err instanceof Error
              ? err.message
              : 'Failed to verify existing seat reservations. Please retry.',
          );
        }
      });

    return () => {
      ignore = true;
    };
  }, [scheduleId, user, authLoading, isInvalidId, applyReconciledReservations]);

  // Cleanup on unmount: release ONLY loose holds (ticketId == null) if no ticket was created (Issue 3)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (!ticketCreatedRef.current) {
        const activeReservations = Array.from(heldReservationsRef.current.values());
        for (const res of activeReservations) {
          // Never release ticket-linked holds implicitly (Issue 3)
          if (res && res.id && res.ticketId == null) {
            void seatsApi.releaseReservation(res.id).catch(() => {});
          }
        }
      }
    };
  }, []);

  // Explicit cancellation of pending checkout (Issue 1)
  const handleCancelPendingCheckout = async (ticketIdToCancel: number) => {
    try {
      setIsSubmitting(true);
      setError(null);
      await ticketsApi.cancelTicket(ticketIdToCancel);

      try {
        if (sessionStorage.getItem(PENDING_TICKET_KEY) === String(ticketIdToCancel)) {
          sessionStorage.removeItem(PENDING_TICKET_KEY);
        }
      } catch {
        // Storage issue ignored
      }

      // Remove seats that belonged to this ticket from local selection and holds
      const ticketSeatIds = new Set<number>();
      for (const [seatId, res] of heldReservations.entries()) {
        if (res.ticketId === ticketIdToCancel) {
          ticketSeatIds.add(seatId);
        }
      }

      setHeldReservations((prev) => {
        const next = new Map(prev);
        for (const id of ticketSeatIds) {
          next.delete(id);
        }
        return next;
      });

      setSelectedSeatIds((prev) => {
        const next = new Set(prev);
        for (const id of ticketSeatIds) {
          next.delete(id);
        }
        return next;
      });

      setPendingTicketId(null);
      setInfoMessage('Your pending checkout was cancelled and its seats were released. You can now select new seats.');
      void reloadSeatMap();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel pending checkout.');
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  // Toggle seat selection (Issue 1: never deselect if server refused release)
  const handleToggleSeat = async (seat: SeatDto) => {
    if (isSubmitting || !isOwnershipReady || !!ownershipError) return;
    setError(null);
    setInfoMessage(null);

    const isCurrentlySelected = selectedSeatIds.has(seat.seatId);

    if (isCurrentlySelected) {
      const existingRes = heldReservations.get(seat.seatId);

      if (existingRes && existingRes.id) {
        // Seat is held on the server
        try {
          await seatsApi.releaseReservation(existingRes.id);
          // Only remove if server actually released it
          setHeldReservations((prev) => {
            const next = new Map(prev);
            next.delete(seat.seatId);
            return next;
          });
          setSelectedSeatIds((prev) => {
            const next = new Set(prev);
            next.delete(seat.seatId);
            if (next.size === 0) {
              setHeldExpiresAt(null);
            }
            return next;
          });
          void reloadSeatMap();
        } catch (err) {
          // Server refused to release! (e.g. 409 because it belongs to a pending ticket - Issue 1)
          // NEVER REMOVE IT FROM THE UI IF RELEASE FAILED!
          if (existingRes.ticketId != null) {
            setError(
              `Seat ${seat.rowLabel}${seat.seatNumber} is part of pending checkout #${existingRes.ticketId}. You can complete payment for your reserved seats, or cancel the pending checkout to change seats.`,
            );
          } else {
            setError(
              err instanceof Error
                ? err.message
                : `Failed to release seat ${seat.rowLabel}${seat.seatNumber}.`,
            );
          }
          // Do NOT remove seat from selectedSeatIds!
          return;
        }
      } else {
        // Seat was only selected locally (not yet held on server)
        setSelectedSeatIds((prev) => {
          const next = new Set(prev);
          next.delete(seat.seatId);
          return next;
        });
      }
    } else {
      // User is attempting to select a new seat
      // If a pending ticket already exists, inform the user they must complete or cancel it (Issue 1)
      if (pendingTicketId != null) {
        setInfoMessage(
          `You have an active pending checkout (#${pendingTicketId}). Complete payment for your reserved seats, or cancel the pending checkout to choose different seats.`,
        );
        return;
      }

      // Check capacity limit: confirmed seats + active holds + unheld selections (Issue 4)
      const confirmedCount = confirmedSeats.length;
      const heldCount = heldReservations.size;
      const unheldSelectedCount = Array.from(selectedSeatIds).filter(
        (id) => !heldReservations.has(id),
      ).length;

      if (confirmedCount + heldCount + unheldSelectedCount >= MAX_SEATS_PER_USER) {
        setInfoMessage(
          `You can hold a maximum of ${MAX_SEATS_PER_USER} seats per showtime (you have ${confirmedCount} confirmed, ${heldCount} held; remaining allowance: ${Math.max(
            0,
            MAX_SEATS_PER_USER - (confirmedCount + heldCount),
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

  // Hold expiry handler: delegate to unified reconciliation (Issues 2, 4)
  const handleHoldExpired = async () => {
    if (!user) {
      setHeldExpiresAt(null);
      setHeldReservations(new Map());
      setSelectedSeatIds(new Set());
      setError('Your seat hold expired. Please select your seats again.');
      void reloadSeatMap();
      return;
    }
    await reconcileReservations(true);
  };

  // Proceed to payment (Issues 1, 2, 3)
  const handleProceed = async () => {
    if (selectedSeatIds.size === 0) {
      setError('Please select at least one seat to continue.');
      return;
    }

    // Must wait for authentication and ownership reconciliation (Issue 2)
    if (authLoading || !isOwnershipReady || ownershipError) {
      setError('Please wait for your reservations to finish loading before proceeding.');
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
        // Storage error ignored
      }
      navigate(`/login?return=/book/${scheduleId}`);
      return;
    }

    const currentSubmissionId = ++submissionIdRef.current;
    try {
      setIsSubmitting(true);
      setError(null);

      // Check for extra loose holds alongside an existing pending ticket (Issue 1)
      const unheldSeatIds = Array.from(selectedSeatIds).filter(
        (id) => !heldReservations.has(id),
      );

      if (pendingTicketId != null && unheldSeatIds.length > 0) {
        setError(
          `You have an existing pending checkout (#${pendingTicketId}). To add new seats, cancel the pending checkout first, or proceed to complete your existing checkout.`,
        );
        setIsSubmitting(false);
        return;
      }

      // Step 1: Hold newly selected seats
      if (unheldSeatIds.length > 0) {
        const holdRes = await seatsApi.holdSeats(scheduleId, unheldSeatIds);

        // Guard async continuation with lifecycle ownership (Issue 3)
        if (!isMountedRef.current || currentSubmissionId !== submissionIdRef.current) {
          // Page was unmounted during holdSeats request; release newly created holds immediately!
          for (const item of holdRes.seats) {
            void seatsApi.releaseReservation(item.reservationId).catch(() => {});
          }
          return;
        }

        setHeldExpiresAt(holdRes.expiresAt);
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

      // Guard async continuation: do not redirect after booking page was disposed (Issue 3)
      if (!isMountedRef.current || currentSubmissionId !== submissionIdRef.current) {
        return;
      }

      ticketCreatedRef.current = true;
      sessionStorage.setItem(PENDING_TICKET_KEY, String(ticketRes.ticketId));

      if (ticketRes.checkoutUrl) {
        window.location.href = ticketRes.checkoutUrl;
      } else {
        navigate('/payment/success');
      }
    } catch (err) {
      if (!isMountedRef.current || currentSubmissionId !== submissionIdRef.current) {
        return;
      }

      if (err instanceof ApiException && err.status === 503) {
        setError(
          'Online payment is currently unavailable (Stripe payment gateway is not configured). Your held seats are preserved.',
        );
      } else if (err instanceof ApiException && err.status === 409) {
        setError(err.message || 'One or more of your selected seats were just taken.');
        void reloadSeatMap();
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred during checkout.');
      }
    } finally {
      if (isMountedRef.current && currentSubmissionId === submissionIdRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  if (isInvalidId || (!baseLoading && !schedule && error)) {
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

  // Show skeleton until base schedule and auth are loaded
  if (baseLoading || authLoading || !schedule) {
    return (
      <div className="screen screen-container">
        <TopBar step={2} />
        <main className="wrap">
          <div className="skeleton" style={{ height: '520px', border: '3px solid var(--ink)' }} />
        </main>
      </div>
    );
  }

  // Calculate allowance including confirmed seats (Issue 4)
  const confirmedCount = confirmedSeats.length;
  const heldCount = heldReservations.size;
  const unheldSelectedCount = Array.from(selectedSeatIds).filter(
    (id) => !heldReservations.has(id),
  ).length;
  const remainingAllowance = Math.max(
    0,
    MAX_SEATS_PER_USER - (confirmedCount + heldCount + unheldSelectedCount),
  );

  return (
    <div className="screen screen-container" id="seats">
      <TopBar step={2} />

      <main className="wrap">
        <div className="kicker">
          {schedule.movie.title} · {schedule.theater.name} · {formatFullDateTime(schedule.startTime)}
        </div>
        <h1>Pick your seats</h1>

        {ownershipError && (
          <div
            className="error-banner"
            role="alert"
            style={{
              marginTop: 'var(--space-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{ownershipError}</span>
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => void reconcileReservations(false)}
            >
              Retry
            </button>
          </div>
        )}

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

        {pendingTicketId != null && (
          <div
            className="pending-checkout-notice"
            style={{
              marginTop: 'var(--space-4)',
              background: 'var(--paper)',
              border: '3px solid var(--red)',
              padding: 'var(--space-4) var(--space-6)',
              boxShadow: 'var(--shadow)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <div>
              <span className="kicker" style={{ color: 'var(--red)' }}>Active checkout pending</span>
              <b>Ticket #{pendingTicketId} is awaiting payment for these seats.</b>
            </div>
            <button
              type="button"
              className="btn btn-compact btn-danger"
              disabled={isSubmitting}
              onClick={() => handleCancelPendingCheckout(pendingTicketId)}
            >
              Cancel pending checkout
            </button>
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
              disabled={isSubmitting || !isOwnershipReady || !!ownershipError}
            />
          </div>

          {/* Dark "YOUR TICKETS" Summary Panel */}
          <aside className="summary" aria-label="Booking summary">
            <div className="head">
              <h2>Your tickets</h2>
            </div>

            <div className="body">
              {confirmedCount > 0 && (
                <div
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    background: '#194240',
                    color: 'var(--paper)',
                    fontSize: '12px',
                    fontWeight: 700,
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  ✓ You have {confirmedCount} confirmed ticket(s) for this showtime
                </div>
              )}

              <div style={{ minHeight: '60px' }}>
                {selectedSeats.length === 0 ? (
                  <p className="soft" style={{ fontSize: '14px', fontStyle: 'italic', padding: 'var(--space-2) 0' }}>
                    Click any available seat in the hall to select.
                  </p>
                ) : (
                  selectedSeats.map((s) => {
                    const held = heldReservations.get(s.seatId);
                    const seatPrice = held ? held.price : s.price;
                    const isTicketLinked = held?.ticketId != null;

                    return (
                      <div key={s.seatId} className="li">
                        <span>
                          {s.rowLabel}{s.seatNumber} · {s.type === 'VIP' ? 'VIP' : 'Standard'}
                          {isTicketLinked && ' [Reserved]'}
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
                disabled={
                  selectedSeats.length === 0 ||
                  isSubmitting ||
                  !isOwnershipReady ||
                  !!ownershipError
                }
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
