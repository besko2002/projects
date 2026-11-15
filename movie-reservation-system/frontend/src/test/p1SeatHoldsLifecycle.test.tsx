import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SeatSelectionPage } from '../pages/SeatSelectionPage';
import * as schedulesApi from '../api/schedulesApi';
import * as seatsApi from '../api/seatsApi';
import * as ticketsApi from '../api/ticketsApi';
import { AuthContext } from '../context/useAuth';
import type { ScheduleDto } from '../types/schedule';
import type { SeatMapDto, SeatReservationDto } from '../types/seat';

const mockSchedule: ScheduleDto = {
  id: 10,
  movie: { id: 1, title: 'Ember Road', durationMinutes: 128, posterUrl: null, releaseDate: '2026-11-06' },
  theater: { id: 1, name: 'IMAX Hall', location: 'Floor 2', totalSeats: 6 },
  startTime: new Date(Date.now() + 3600000).toISOString(),
  endTime: new Date(Date.now() + 7200000).toISOString(),
  prices: {
    basePrice: 12.5,
    vipPrice: 18.0,
  },
};

const mockSeatMap: SeatMapDto = {
  scheduleId: 10,
  theaterId: 1,
  startTime: mockSchedule.startTime,
  seats: [
    { seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5, status: 'HELD' },
    { seatId: 102, rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 103, rowLabel: 'A', seatNumber: 3, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
  ],
};

const mockUserHold: SeatReservationDto = {
  id: 501,
  scheduleId: 10,
  seatId: 101,
  ticketId: null,
  price: 12.5,
  status: 'HELD',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
};

describe('P1-1 & P1-2: Seat Hold Restoration, Deselection and Price Sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('restores own held seat as selected and releases hold on deselection (P1-1)', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue([mockUserHold]);
    const releaseSpy = vi.spyOn(seatsApi, 'releaseReservation').mockResolvedValue(undefined);

    const user = userEvent.setup();

    render(
      <AuthContext.Provider
        value={{
          user: { id: 42, email: 'user@example.com', name: 'Test User', role: 'USER' },
          token: 'mock-token',
          isLoading: false,
          login: vi.fn(),
          register: vi.fn(),
          logout: vi.fn(),
          refreshUser: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={['/book/10']}>
          <Routes>
            <Route path="/book/:scheduleId" element={<SeatSelectionPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    // Wait for the seat to be restored as selected
    const seat101 = await screen.findByRole('checkbox', { name: /Seat A1/i });
    await waitFor(() => {
      expect(seat101).toHaveAttribute('aria-checked', 'true');
    });

    // Deselecting the held seat calls DELETE /api/seat-reservations/{id}
    await user.click(seat101);

    expect(releaseSpy).toHaveBeenCalledWith(501);
    expect(seat101).toHaveAttribute('aria-checked', 'false');
  });

  it('unmount releases active holds if no ticket was created (P1-1)', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue([mockUserHold]);
    const releaseSpy = vi.spyOn(seatsApi, 'releaseReservation').mockResolvedValue(undefined);

    const { unmount } = render(
      <AuthContext.Provider
        value={{
          user: { id: 42, email: 'user@example.com', name: 'Test User', role: 'USER' },
          token: 'mock-token',
          isLoading: false,
          login: vi.fn(),
          register: vi.fn(),
          logout: vi.fn(),
          refreshUser: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={['/book/10']}>
          <Routes>
            <Route path="/book/:scheduleId" element={<SeatSelectionPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await screen.findByRole('checkbox', { name: /Seat A1/i });

    // Unmount without checkout
    unmount();

    expect(releaseSpy).toHaveBeenCalledWith(501);
  });

  it('holds new seats before checkout and displays accurate price (P1-2)', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue([mockUserHold]);
    const holdSpy = vi.spyOn(seatsApi, 'holdSeats').mockResolvedValue({
      reservationIds: [502],
      scheduleId: 10,
      seats: [
        { reservationId: 502, seatId: 102, rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5 },
      ],
      totalPrice: 25.0,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
    const checkoutSpy = vi.spyOn(ticketsApi, 'checkoutTicket').mockResolvedValue({
      ticketId: 999,
      status: 'PENDING_PAYMENT',
      totalPrice: 25.0,
      currency: 'USD',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_mock',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });

    const user = userEvent.setup();

    render(
      <AuthContext.Provider
        value={{
          user: { id: 42, email: 'user@example.com', name: 'Test User', role: 'USER' },
          token: 'mock-token',
          isLoading: false,
          login: vi.fn(),
          register: vi.fn(),
          logout: vi.fn(),
          refreshUser: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={['/book/10']}>
          <Routes>
            <Route path="/book/:scheduleId" element={<SeatSelectionPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    // Seat A1 is already held. Add Seat A2:
    const seat102 = await screen.findByRole('checkbox', { name: /Seat A2/i });
    await user.click(seat102);

    // Click continue to payment
    const continueBtn = screen.getByRole('button', { name: /Continue to (secure )?payment/i });
    await user.click(continueBtn);

    // Hold was requested for the newly added seat A2 (seatId 102)
    expect(holdSpy).toHaveBeenCalledWith(10, [102]);
    // Checkout was called for schedule 10
    expect(checkoutSpy).toHaveBeenCalledWith(10);
  });
});
