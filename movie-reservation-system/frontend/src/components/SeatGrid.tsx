import React from 'react';
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

  return (
    <div className="stage" aria-label="Cinema Hall Seat Map">
      <div className="screen-arc" aria-hidden="true">SCREEN</div>

      <div className="seats-grid" role="region" aria-label="Hall seating grid">
        {sortedRowLabels.map((rowLabel) => {
          const rowSeats = (rowsMap.get(rowLabel) || []).sort(
            (a, b) => a.seatNumber - b.seatNumber,
          );
          const midIndex = Math.floor(rowSeats.length / 2);

          return (
            <div key={rowLabel} className="srow" role="group" aria-label={`Row ${rowLabel}`}>
              <span className="lbl" aria-hidden="true">{rowLabel}</span>

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
                  symbol = '⏱';
                  statusDescription = 'Held by someone';
                } else if (isVip) {
                  statusClass = 'vip';
                  symbol = '◆';
                  statusDescription = 'VIP Available';
                }

                const isDisabled = !isAvailable || (!isSelected && maxSeatsReached);

                return (
                  <button
                    key={seat.seatId}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    disabled={isDisabled}
                    className={`seat-btn ${statusClass} ${hasAisleGap ? 'gap' : ''}`}
                    onClick={() => onToggleSeat(seat)}
                    aria-label={`Seat ${seat.rowLabel}${seat.seatNumber}, ${isVip ? 'VIP' : 'Standard'}, $${seat.price.toFixed(2)}, ${statusDescription}`}
                    title={`Row ${seat.rowLabel} Seat ${seat.seatNumber} (${isVip ? 'VIP' : 'Standard'}) - $${seat.price.toFixed(2)} [${statusDescription}]`}
                  >
                    <span aria-hidden="true">{symbol}</span>
                  </button>
                );
              })}

              <span className="lbl" aria-hidden="true">{rowLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="legend" role="list" aria-label="Seat Map Legend">
        <span role="listitem">
          <i className="seat-btn" aria-hidden="true" />
          Standard
        </span>
        <span role="listitem">
          <i className="seat-btn vip" aria-hidden="true">◆</i>
          VIP
        </span>
        <span role="listitem">
          <i className="seat-btn sel" aria-hidden="true">✓</i>
          Your selection
        </span>
        <span role="listitem">
          <i className="seat-btn held" aria-hidden="true">⏱</i>
          Held by someone
        </span>
        <span role="listitem">
          <i className="seat-btn booked" aria-hidden="true">✕</i>
          Booked
        </span>
      </div>
    </div>
  );
}
