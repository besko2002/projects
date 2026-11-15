import React, { useState, useRef } from 'react';
import type { SeatDto } from '../types/seat';

interface SeatGridProps {
  seats: SeatDto[];
  selectedSeatIds: Set<number>;
  onToggleSeat: (seat: SeatDto) => void;
  maxSeatsReached?: boolean;
}

export function SeatGrid({
  seats,
  selectedSeatIds,
  onToggleSeat,
  maxSeatsReached = false,
}: SeatGridProps): React.JSX.Element {
  // Group seats by row
  const rowsMap = new Map<string, SeatDto[]>();
  for (const seat of seats) {
    const list = rowsMap.get(seat.rowLabel) || [];
    list.push(seat);
    rowsMap.set(seat.rowLabel, list);
  }

  // Sort rows alphabetically
  const sortedRowLabels = Array.from(rowsMap.keys()).sort();

  // Find initial focusable seat (first selected, or first available, or first seat)
  const [focusedSeatId, setFocusedSeatId] = useState<number | null>(() => {
    const firstSelected = seats.find((s) => selectedSeatIds.has(s.seatId));
    if (firstSelected) return firstSelected.seatId;
    const firstAvail = seats.find((s) => s.status === 'AVAILABLE');
    return firstAvail?.seatId ?? seats[0]?.seatId ?? null;
  });

  // Track button refs for programmatic focus on arrow keys
  const seatButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const effectiveFocusedSeatId = focusedSeatId ?? seats[0]?.seatId ?? null;

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    rowLabel: string,
    seatNumber: number,
  ) => {
    let targetSeat: SeatDto | undefined;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const row = rowsMap.get(rowLabel) || [];
      targetSeat = row.find((s) => s.seatNumber === seatNumber + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const row = rowsMap.get(rowLabel) || [];
      targetSeat = row.find((s) => s.seatNumber === seatNumber - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRowIdx = sortedRowLabels.indexOf(rowLabel) + 1;
      if (nextRowIdx < sortedRowLabels.length) {
        const nextRow = rowsMap.get(sortedRowLabels[nextRowIdx]) || [];
        targetSeat = nextRow.find((s) => s.seatNumber === seatNumber) || nextRow[0];
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevRowIdx = sortedRowLabels.indexOf(rowLabel) - 1;
      if (prevRowIdx >= 0) {
        const prevRow = rowsMap.get(sortedRowLabels[prevRowIdx]) || [];
        targetSeat = prevRow.find((s) => s.seatNumber === seatNumber) || prevRow[0];
      }
    }

    if (targetSeat) {
      setFocusedSeatId(targetSeat.seatId);
      const el = seatButtonRefs.current.get(targetSeat.seatId);
      el?.focus();
    }
  };

  return (
    <div className="hall" aria-label="Cinema Hall Seat Map">
      <div className="screen-strip" aria-hidden="true" />
      <div className="screen-label">SCREEN</div>

      <div className="seats" role="region" aria-label="Hall seating grid">
        {sortedRowLabels.map((rowLabel) => {
          const rowSeats = (rowsMap.get(rowLabel) || []).sort(
            (a, b) => a.seatNumber - b.seatNumber,
          );
          const midIndex = Math.floor(rowSeats.length / 2);

          return (
            <div key={rowLabel} className="row" role="group" aria-label={`Row ${rowLabel}`}>
              <span className="l" aria-hidden="true">{rowLabel}</span>

              {rowSeats.map((seat, idx) => {
                const isSelected = selectedSeatIds.has(seat.seatId);
                const isAvailable = seat.status === 'AVAILABLE';
                const isHeld = seat.status === 'HELD';
                const isBooked = seat.status === 'BOOKED';
                const isVip = seat.type === 'VIP';
                const hasAisleGap = idx === midIndex - 1 && rowSeats.length > 6;

                let statusClass = '';
                let symbol = '';
                let statusDescription = 'Available';

                if (isSelected) {
                  statusClass = 'sel';
                  symbol = '✓';
                  statusDescription = 'Selected';
                } else if (isBooked) {
                  statusClass = 'booked';
                  symbol = '✕';
                  statusDescription = 'Booked';
                } else if (isHeld) {
                  statusClass = 'held';
                  symbol = '';
                  statusDescription = 'Held by someone';
                } else if (isVip) {
                  statusClass = 'vip';
                  symbol = '★';
                  statusDescription = 'VIP Available';
                }

                const limitDisabled = !isSelected && maxSeatsReached;
                const isDisabled = (!isAvailable && !isSelected) || limitDisabled;

                const limitExplanation = limitDisabled
                  ? ' (Selection limit reached: maximum 8 seats per user for this showtime)'
                  : '';

                const isFocused = effectiveFocusedSeatId === seat.seatId;

                return (
                  <button
                    key={seat.seatId}
                    ref={(el) => {
                      if (el) seatButtonRefs.current.set(seat.seatId, el);
                      else seatButtonRefs.current.delete(seat.seatId);
                    }}
                    type="button"
                    role="checkbox"
                    tabIndex={isFocused ? 0 : -1}
                    aria-checked={isSelected}
                    disabled={isDisabled}
                    className={`s ${statusClass} ${isVip ? 'vip' : ''} ${hasAisleGap ? 'gap' : ''}`}
                    onClick={() => {
                      setFocusedSeatId(seat.seatId);
                      onToggleSeat(seat);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, seat.rowLabel, seat.seatNumber)}
                    onFocus={() => setFocusedSeatId(seat.seatId)}
                    aria-label={`Seat ${seat.rowLabel}${seat.seatNumber}, ${isVip ? 'VIP' : 'Standard'}, $${seat.price.toFixed(2)}, ${statusDescription}${limitExplanation}`}
                    title={`Seat ${seat.rowLabel}${seat.seatNumber} (${isVip ? 'VIP' : 'Standard'}) - $${seat.price.toFixed(2)} [${statusDescription}]${limitExplanation}`}
                  >
                    <span aria-hidden="true">{symbol}</span>
                  </button>
                );
              })}

              <span className="l" aria-hidden="true">{rowLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="legend" role="list" aria-label="Seat Map Legend">
        <span role="listitem">
          <i className="s" aria-hidden="true" />
          Standard
        </span>
        <span role="listitem">
          <i className="s vip" aria-hidden="true">★</i>
          VIP
        </span>
        <span role="listitem">
          <i className="s sel" aria-hidden="true">✓</i>
          Yours
        </span>
        <span role="listitem">
          <i className="s held" aria-hidden="true" />
          Held
        </span>
        <span role="listitem">
          <i className="s booked" aria-hidden="true">✕</i>
          Taken
        </span>
      </div>
    </div>
  );
}
