import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TicketCard } from '../components/TicketCard';
import type { TicketDto } from '../types/ticket';

describe('TicketCard Component & Status Rendering', () => {
  const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString(); // 48 hours in future

  const baseTicket: TicketDto = {
    id: 101,
    scheduleId: 10,
    movieTitle: 'Tidewatch',
    scheduleStartTime: futureDate,
    status: 'PAID',
    totalPrice: 25.0,
    currency: 'usd',
    seatCount: 2,
    seats: [
      { rowLabel: 'C', seatNumber: 4, type: 'NORMAL', price: 12.5 },
      { rowLabel: 'C', seatNumber: 5, type: 'NORMAL', price: 12.5 },
    ],
    paidAt: '2026-11-14T10:00:00Z',
    cancelledAt: null,
  };

  it('renders PAID ticket with active cancel button when before cutoff', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<TicketCard ticket={baseTicket} onCancel={onCancel} />);

    expect(screen.getByText(/● PAID/i)).toBeInTheDocument();
    expect(screen.getByText(/C4 · C5/i)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /cancel & refund/i });
    expect(cancelBtn).toBeEnabled();

    await user.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledWith(101);
  });

  it('disables cancel button when cancellation cutoff has passed (within 2h)', () => {
    const passedDate = new Date(Date.now() + 1 * 3600 * 1000).toISOString(); // 1 hour in future (cutoff is 2h)
    const passedTicket: TicketDto = {
      ...baseTicket,
      scheduleStartTime: passedDate,
    };

    render(<TicketCard ticket={passedTicket} onCancel={vi.fn()} />);

    const cancelBtn = screen.getByRole('button', { name: /cancel & refund/i });
    expect(cancelBtn).toBeDisabled();
    expect(screen.getByText(/cancellation cutoff passed/i)).toBeInTheDocument();
  });

  it('renders REFUNDED status with refunded label and no cancel button', () => {
    const refundedTicket: TicketDto = {
      ...baseTicket,
      status: 'REFUNDED',
      cancelledAt: '2026-11-14T12:00:00Z',
    };

    render(<TicketCard ticket={refundedTicket} onCancel={vi.fn()} />);

    expect(screen.getByText(/● REFUNDED/i)).toBeInTheDocument();
    expect(screen.getByText(/refunded to your card/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel & refund/i })).not.toBeInTheDocument();
  });
});
