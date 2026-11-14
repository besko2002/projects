import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PaymentSuccessPage } from '../pages/PaymentSuccessPage';
import { AuthProvider } from '../context/AuthContext';
import * as ticketsApi from '../api/ticketsApi';
import type { TicketDto } from '../types/ticket';

vi.mock('../api/ticketsApi');

const pendingTicket: TicketDto = {
  id: 1042,
  scheduleId: 1,
  movieTitle: 'Ember Road',
  scheduleStartTime: '2026-11-20T18:00:00Z',
  status: 'PENDING_PAYMENT',
  totalPrice: 43.0,
  currency: 'usd',
  seatCount: 3,
  seats: [
    { rowLabel: 'E', seatNumber: 7, type: 'NORMAL', price: 12.5 },
    { rowLabel: 'E', seatNumber: 8, type: 'NORMAL', price: 12.5 },
    { rowLabel: 'H', seatNumber: 5, type: 'VIP', price: 18.0 },
  ],
  paidAt: null,
  cancelledAt: null,
};

const paidTicket: TicketDto = {
  ...pendingTicket,
  status: 'PAID',
  paidAt: '2026-11-15T12:00:00Z',
};

describe('Payment Success Polling Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.setItem('cinebook_pending_ticket_id', '1042');
  });

  it('polls ticket until PAID status arrives via webhook verification', async () => {
    vi.mocked(ticketsApi.getTicket)
      .mockResolvedValueOnce(pendingTicket)
      .mockResolvedValueOnce(paidTicket);

    render(
      <MemoryRouter initialEntries={['/payment/success']}>
        <AuthProvider>
          <Routes>
            <Route path="/payment/success" element={<PaymentSuccessPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Initial polling banner
    expect(screen.getByText(/confirming payment with stripe/i)).toBeInTheDocument();

    // After polling reaches PAID
    await waitFor(() => {
      expect(screen.getByText(/you're going to the movies!/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText(/CB-1042-E7E8H5/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nov 20/i).length).toBeGreaterThanOrEqual(1);
  });
});
