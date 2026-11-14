import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { SeatGrid } from '../components/SeatGrid';
import type { SeatDto } from '../types/seat';

const mockSeats: SeatDto[] = [
  { seatId: 1, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
  { seatId: 2, rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
  { seatId: 3, rowLabel: 'A', seatNumber: 3, type: 'VIP', price: 18.0, status: 'AVAILABLE' },
  { seatId: 4, rowLabel: 'A', seatNumber: 4, type: 'NORMAL', price: 12.5, status: 'HELD' },
  { seatId: 5, rowLabel: 'A', seatNumber: 5, type: 'NORMAL', price: 12.5, status: 'BOOKED' },
];

function TestSeatGridWrapper({ initialSeats = mockSeats, maxSeats = 2 }: { initialSeats?: SeatDto[]; maxSeats?: number }) {
  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<number>>(new Set());

  const handleToggle = (seat: SeatDto) => {
    setSelectedSeatIds((prev) => {
      const next = new Set(prev);
      if (next.has(seat.seatId)) {
        next.delete(seat.seatId);
      } else {
        if (next.size >= maxSeats) return prev;
        next.add(seat.seatId);
      }
      return next;
    });
  };

  return (
    <SeatGrid
      seats={initialSeats}
      selectedSeatIds={selectedSeatIds}
      onToggleSeat={handleToggle}
      maxSeatsReached={selectedSeatIds.size >= maxSeats}
    />
  );
}

describe('SeatGrid Component', () => {
  it('renders seats with accessible names and statuses', () => {
    render(<TestSeatGridWrapper />);

    expect(screen.getByRole('checkbox', { name: /Seat A1, Standard, \$12\.50, Available/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Seat A3, VIP, \$18\.00, VIP Available/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Seat A4, Standard, \$12\.50, Held by someone/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Seat A5, Standard, \$12\.50, Booked/i })).toBeDisabled();
  });

  it('selects and deselects available seats on click', async () => {
    const user = userEvent.setup();
    render(<TestSeatGridWrapper />);

    const seatA1 = screen.getByRole('checkbox', { name: /Seat A1/i });
    expect(seatA1).toHaveAttribute('aria-checked', 'false');

    await user.click(seatA1);
    expect(seatA1).toHaveAttribute('aria-checked', 'true');

    await user.click(seatA1);
    expect(seatA1).toHaveAttribute('aria-checked', 'false');
  });

  it('respects maximum seats limit and disables additional selections', async () => {
    const user = userEvent.setup();
    render(<TestSeatGridWrapper maxSeats={2} />);

    const seatA1 = screen.getByRole('checkbox', { name: /Seat A1/i });
    const seatA2 = screen.getByRole('checkbox', { name: /Seat A2/i });
    const seatA3 = screen.getByRole('checkbox', { name: /Seat A3/i });

    await user.click(seatA1);
    await user.click(seatA2);

    expect(seatA1).toHaveAttribute('aria-checked', 'true');
    expect(seatA2).toHaveAttribute('aria-checked', 'true');

    // Seat A3 should now be disabled since limit is reached
    expect(seatA3).toBeDisabled();
  });
});
