import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PaymentCancelPage } from '../pages/PaymentCancelPage';
import { MyTicketsPage } from '../pages/MyTicketsPage';
import * as ticketsApi from '../api/ticketsApi';
import { AuthContext } from '../context/useAuth';
import type { TicketDto } from '../types/ticket';

const mockPendingTicket: TicketDto = {
  id: 777,
  scheduleId: 10,
  movieTitle: 'Ember Road',
  scheduleStartTime: new Date(Date.now() + 14400000).toISOString(), // 4 hours in future
  status: 'PENDING_PAYMENT',
  totalPrice: 25.0,
  currency: 'USD',
  seatCount: 2,
  seats: [
    { rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5 },
    { rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5 },
  ],
  paidAt: null,
  cancelledAt: null,
};

const mockAuthValue = {
  user: { id: 42, email: 'user@example.com', name: 'Test User', role: 'USER' as const },
  token: 'mock-token',
  isLoading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
};

describe('P1-3 & P2-7: Payment Recovery & Dialog Cancellation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('PaymentCancelPage Try again calls checkoutTicket with scheduleId and stores ticketId (P1-3)', async () => {
    sessionStorage.setItem('cinebook_pending_ticket_id', '777');
    vi.spyOn(ticketsApi, 'getTicket').mockResolvedValue(mockPendingTicket);
    const checkoutSpy = vi.spyOn(ticketsApi, 'checkoutTicket').mockResolvedValue({
      ticketId: 777,
      status: 'PENDING_PAYMENT',
      totalPrice: 25.0,
      currency: 'USD',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_again',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });

    const user = userEvent.setup();

    render(
      <AuthContext.Provider value={mockAuthValue}>
        <MemoryRouter initialEntries={['/payment/cancel']}>
          <Routes>
            <Route path="/payment/cancel" element={<PaymentCancelPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const tryAgainBtn = await screen.findByRole('button', { name: /Try again/i });
    await user.click(tryAgainBtn);

    expect(checkoutSpy).toHaveBeenCalledWith(10);
    expect(sessionStorage.getItem('cinebook_pending_ticket_id')).toBe('777');
  });

  it('PaymentCancelPage Release seats calls cancelTicket and clears pending storage (P1-3)', async () => {
    sessionStorage.setItem('cinebook_pending_ticket_id', '777');
    vi.spyOn(ticketsApi, 'getTicket').mockResolvedValue(mockPendingTicket);
    const cancelSpy = vi.spyOn(ticketsApi, 'cancelTicket').mockResolvedValue(undefined);

    const user = userEvent.setup();

    render(
      <AuthContext.Provider value={mockAuthValue}>
        <MemoryRouter initialEntries={['/payment/cancel']}>
          <Routes>
            <Route path="/payment/cancel" element={<PaymentCancelPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const releaseBtn = await screen.findByRole('button', { name: /Release seats/i });
    await user.click(releaseBtn);

    expect(cancelSpy).toHaveBeenCalledWith(777);
    expect(sessionStorage.getItem('cinebook_pending_ticket_id')).toBeNull();
    expect(await screen.findByText(/held seats have been released/i)).toBeInTheDocument();
  });

  it('MyTicketsPage Complete payment resumes checkout via scheduleId (P1-3)', async () => {
    vi.spyOn(ticketsApi, 'getMyTickets').mockResolvedValue({
      content: [mockPendingTicket],
      page: 0,
      size: 10,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });
    const checkoutSpy = vi.spyOn(ticketsApi, 'checkoutTicket').mockResolvedValue({
      ticketId: 777,
      status: 'PENDING_PAYMENT',
      totalPrice: 25.0,
      currency: 'USD',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_resume',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });

    const user = userEvent.setup();

    render(
      <AuthContext.Provider value={mockAuthValue}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Routes>
            <Route path="/tickets" element={<MyTicketsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const payBtn = await screen.findByRole('button', { name: /Complete payment/i });
    await user.click(payBtn);

    expect(checkoutSpy).toHaveBeenCalledWith(10);
    expect(sessionStorage.getItem('cinebook_pending_ticket_id')).toBe('777');
  });

  it('MyTicketsPage displays cancellation error inside the cancel dialog (P2-7)', async () => {
    const paidTicket: TicketDto = { ...mockPendingTicket, id: 888, status: 'PAID' };
    vi.spyOn(ticketsApi, 'getMyTickets').mockResolvedValue({
      content: [paidTicket],
      page: 0,
      size: 10,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });
    vi.spyOn(ticketsApi, 'cancelTicket').mockRejectedValue(new Error('Cancellation cutoff passed: within 2 hours of show'));

    const user = userEvent.setup();

    render(
      <AuthContext.Provider value={mockAuthValue}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Routes>
            <Route path="/tickets" element={<MyTicketsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const cancelBtn = await screen.findByRole('button', { name: /Cancel & refund/i });
    expect(cancelBtn).toBeEnabled();
    await user.click(cancelBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Confirm cancellation/i });
    await user.click(confirmBtn);

    // Verify error appears inside the open dialog (P2-7)
    await waitFor(() => {
      expect(dialog).toHaveTextContent(/Cancellation cutoff passed/i);
    });
  });
});
