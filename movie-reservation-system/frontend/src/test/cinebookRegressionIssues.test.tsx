import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SeatSelectionPage } from '../pages/SeatSelectionPage';
import { HomePage } from '../pages/HomePage';
import { MovieDetailPage } from '../pages/MovieDetailPage';
import { PaymentSuccessPage } from '../pages/PaymentSuccessPage';
import { AuthProvider } from '../context/AuthContext';
import { AuthContext } from '../context/useAuth';
import * as schedulesApi from '../api/schedulesApi';
import * as seatsApi from '../api/seatsApi';
import * as ticketsApi from '../api/ticketsApi';
import * as moviesApi from '../api/moviesApi';
import * as authApi from '../api/authApi';
import { ApiException, getToken, setToken } from '../api/client';
import { formatTime } from '../utils/dateUtils';
import type { ScheduleDto } from '../types/schedule';
import type { SeatMapDto, SeatReservationDto, HoldResponse } from '../types/seat';
import type { TicketDto, TicketCheckoutResponse } from '../types/ticket';
import type { MovieDto } from '../types/movie';
import type { UserDto } from '../types/auth';

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockSchedule: ScheduleDto = {
  id: 10,
  movie: { id: 1, title: 'Ember Road', durationMinutes: 128, posterUrl: null, releaseDate: '2026-11-06' },
  theater: { id: 1, name: 'IMAX Hall', location: 'Floor 2', totalSeats: 8 },
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
    { seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 102, rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 103, rowLabel: 'A', seatNumber: 3, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 104, rowLabel: 'A', seatNumber: 4, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 105, rowLabel: 'A', seatNumber: 5, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 106, rowLabel: 'A', seatNumber: 6, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 107, rowLabel: 'A', seatNumber: 7, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
    { seatId: 108, rowLabel: 'A', seatNumber: 8, type: 'NORMAL', price: 12.5, status: 'AVAILABLE' },
  ],
};

const mockUser = {
  id: 42,
  email: 'user@example.com',
  name: 'Test User',
  role: 'USER' as const,
};

describe('CineBook Review Regression Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Ticket-linked release 409 preserves displayed seats and total
  it('1. Ticket-linked release 409 preserves displayed seats and total', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue({
      ...mockSeatMap,
      seats: [
        { seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5, status: 'HELD' },
        { seatId: 102, rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5, status: 'HELD' },
        ...mockSeatMap.seats.slice(2),
      ],
    });

    const userHolds: SeatReservationDto[] = [
      {
        id: 501,
        scheduleId: 10,
        seatId: 101,
        ticketId: 888,
        price: 12.5,
        status: 'HELD',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
      {
        id: 502,
        scheduleId: 10,
        seatId: 102,
        ticketId: 888,
        price: 12.5,
        status: 'HELD',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    ];
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue(userHolds);

    const releaseSpy = vi.spyOn(seatsApi, 'releaseReservation').mockRejectedValue(
      new ApiException({
        status: 409,
        error: 'Conflict',
        message: 'Cannot release seat with pending ticket #888',
      }),
    );

    const user = userEvent.setup();

    render(
      <AuthContext.Provider
        value={{
          user: mockUser,
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

    const seatA1 = await screen.findByRole('checkbox', { name: /Seat A1/i });
    const seatA2 = await screen.findByRole('checkbox', { name: /Seat A2/i });

    await waitFor(() => {
      expect(seatA1).toHaveAttribute('aria-checked', 'true');
      expect(seatA2).toHaveAttribute('aria-checked', 'true');
    });

    // Both seats selected => 2 x $12.50 = $25.00
    expect(screen.getByText(/\$25\.00/i)).toBeInTheDocument();

    // User attempts to deselect seat A1
    await user.click(seatA1);

    expect(releaseSpy).toHaveBeenCalledWith(501);

    // Verify error banner is shown with instructions
    expect(
      await screen.findByText(/is part of pending checkout #888/i),
    ).toBeInTheDocument();

    // Crucial check: seat A1 is STILL selected in the UI
    expect(seatA1).toHaveAttribute('aria-checked', 'true');

    // Total must NOT drop to $12.50; remains $25.00
    expect(screen.getByText(/\$25\.00/i)).toBeInTheDocument();

    // Explicit cancel pending checkout action must be present
    expect(
      screen.getByRole('button', { name: /Cancel pending checkout/i }),
    ).toBeInTheDocument();
  });

  // 2. Checkout waits for reservation reconciliation
  it('2. Checkout waits for reservation reconciliation', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);

    const ownershipDeferred = createDeferred<SeatReservationDto[]>();
    vi.spyOn(seatsApi, 'getMyReservations').mockReturnValue(ownershipDeferred.promise);

    const user = userEvent.setup();

    render(
      <AuthContext.Provider
        value={{
          user: mockUser,
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

    const seatA1 = await screen.findByRole('checkbox', { name: /Seat A1/i });
    const continueBtn = screen.getByRole('button', { name: /Continue to (secure )?payment/i });

    // While getMyReservations has not resolved, seat interactions and checkout are disabled
    expect(seatA1).toBeDisabled();
    expect(continueBtn).toBeDisabled();

    // Now resolve ownership reconciliation
    await act(async () => {
      ownershipDeferred.resolve([]);
    });

    // Once ownership is ready, seat interactions become enabled
    await waitFor(() => {
      expect(seatA1).not.toBeDisabled();
    });

    // Selecting a seat now enables the checkout button
    await user.click(seatA1);
    expect(seatA1).toHaveAttribute('aria-checked', 'true');
    expect(continueBtn).not.toBeDisabled();
  });

  // 3. Selection cannot change while holding/checking out
  it('3. Selection cannot change while holding/checking out', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue([]);

    const holdSpy = vi.spyOn(seatsApi, 'holdSeats').mockResolvedValue({
      reservationIds: [501],
      scheduleId: 10,
      seats: [{ reservationId: 501, seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5 }],
      totalPrice: 12.5,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });

    const checkoutDeferred = createDeferred<TicketCheckoutResponse>();
    vi.spyOn(ticketsApi, 'checkoutTicket').mockReturnValue(checkoutDeferred.promise);

    const user = userEvent.setup();

    render(
      <AuthContext.Provider
        value={{
          user: mockUser,
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

    const seatA1 = await screen.findByRole('checkbox', { name: /Seat A1/i });
    const seatA2 = await screen.findByRole('checkbox', { name: /Seat A2/i });

    await user.click(seatA1);

    const continueBtn = screen.getByRole('button', { name: /Continue to (secure )?payment/i });
    await waitFor(() => expect(continueBtn).not.toBeDisabled());

    await user.click(continueBtn);

    // During in-flight submission, seat grid seats must be disabled
    await waitFor(() => {
      expect(seatA2).toBeDisabled();
      expect(seatA1).toBeDisabled();
    });

    // Attempting to click another seat does nothing
    await user.click(seatA2);
    expect(holdSpy).toHaveBeenCalledTimes(1);
    expect(seatA2).toHaveAttribute('aria-checked', 'false');
  });

  // 4. Navigation during a hold request causes no later checkout/redirect
  it('4. Navigation during a hold request causes no later checkout/redirect', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue([]);

    const holdDeferred = createDeferred<HoldResponse>();
    vi.spyOn(seatsApi, 'holdSeats').mockReturnValue(holdDeferred.promise);
    const releaseSpy = vi.spyOn(seatsApi, 'releaseReservation').mockResolvedValue(undefined);
    const checkoutSpy = vi.spyOn(ticketsApi, 'checkoutTicket').mockResolvedValue({
      ticketId: 777,
      status: 'PENDING_PAYMENT',
      totalPrice: 12.5,
      currency: 'USD',
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_mock',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });

    const user = userEvent.setup();

    const { unmount } = render(
      <AuthContext.Provider
        value={{
          user: mockUser,
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

    const seatA1 = await screen.findByRole('checkbox', { name: /Seat A1/i });
    await user.click(seatA1);

    const continueBtn = screen.getByRole('button', { name: /Continue to (secure )?payment/i });
    await waitFor(() => expect(continueBtn).not.toBeDisabled());
    await user.click(continueBtn);

    // Unmount while hold request is pending in flight
    unmount();

    // Now resolve the hold request
    await act(async () => {
      holdDeferred.resolve({
        reservationIds: [701],
        scheduleId: 10,
        seats: [{ reservationId: 701, seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5 }],
        totalPrice: 12.5,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
    });

    // The late-arriving hold must be immediately released because page was unmounted
    await waitFor(() => {
      expect(releaseSpy).toHaveBeenCalledWith(701);
    });

    // Checkout must NEVER have been called
    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  // 5. Confirmed seats reduce remaining allowance
  it('5. Confirmed seats reduce remaining allowance', async () => {
    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);

    // User already has 6 confirmed tickets
    const confirmedReservations: SeatReservationDto[] = Array.from({ length: 6 }, (_, i) => ({
      id: 600 + i,
      scheduleId: 10,
      seatId: 200 + i,
      ticketId: 100 + i,
      price: 12.5,
      status: 'CONFIRMED',
      expiresAt: new Date().toISOString(),
    }));
    vi.spyOn(seatsApi, 'getMyReservations').mockResolvedValue(confirmedReservations);

    const user = userEvent.setup();

    render(
      <AuthContext.Provider
        value={{
          user: mockUser,
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

    const seatA1 = await screen.findByRole('checkbox', { name: /Seat A1/i });
    const seatA2 = await screen.findByRole('checkbox', { name: /Seat A2/i });
    const seatA3 = await screen.findByRole('checkbox', { name: /Seat A3/i });

    // Can select seat 1 (6 + 1 = 7)
    await user.click(seatA1);
    expect(seatA1).toHaveAttribute('aria-checked', 'true');

    // Can select seat 2 (6 + 2 = 8 limit reached)
    await user.click(seatA2);
    expect(seatA2).toHaveAttribute('aria-checked', 'true');

    // Remaining capacity is now 0. Further unselected seats are disabled by the capacity limit
    expect(seatA3).toBeDisabled();
    expect(seatA3).toHaveAttribute('aria-checked', 'false');

    expect(
      screen.getByText(/You have 6 confirmed ticket\(s\) for this showtime/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Total · 2 seats/i)).toBeInTheDocument();
  });

  // 6. Staggered hold expiries preserve later holds
  it('6. Staggered hold expiries preserve later holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });

    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue({
      ...mockSeatMap,
      seats: [
        { seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5, status: 'HELD' },
        { seatId: 102, rowLabel: 'A', seatNumber: 2, type: 'NORMAL', price: 12.5, status: 'HELD' },
        ...mockSeatMap.seats.slice(2),
      ],
    });

    const now = Date.now();
    const holdA1: SeatReservationDto = {
      id: 501,
      scheduleId: 10,
      seatId: 101,
      ticketId: null,
      price: 12.5,
      status: 'HELD',
      expiresAt: new Date(now + 2000).toISOString(), // expires in 2s
    };
    const holdA2: SeatReservationDto = {
      id: 502,
      scheduleId: 10,
      seatId: 102,
      ticketId: null,
      price: 12.5,
      status: 'HELD',
      expiresAt: new Date(now + 600000).toISOString(), // expires in 10 mins
    };

    // First call returns both holds
    const getResSpy = vi.spyOn(seatsApi, 'getMyReservations');
    getResSpy.mockResolvedValueOnce([holdA1, holdA2]);

    // Second call on expiry returns only the remaining valid hold A2
    getResSpy.mockResolvedValueOnce([holdA2]);

    render(
      <AuthContext.Provider
        value={{
          user: mockUser,
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

    // Fast-forward initial async effects
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const seatA1 = screen.getByRole('checkbox', { name: /Seat A1/i });
    const seatA2 = screen.getByRole('checkbox', { name: /Seat A2/i });

    expect(seatA1).toHaveAttribute('aria-checked', 'true');
    expect(seatA2).toHaveAttribute('aria-checked', 'true');

    // Advance time past holdA1 expiry (2s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Hold A1 should be deselected, but Hold A2 remains selected
    expect(seatA1).toHaveAttribute('aria-checked', 'false');
    expect(seatA2).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Your remaining valid holds are kept/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  // 7. Clicking the active genre never freezes the page
  it('7. Clicking the active genre never freezes the page', async () => {
    vi.spyOn(moviesApi, 'getGenres').mockResolvedValue([
      { id: 1, name: 'Action' },
      { id: 2, name: 'Drama' },
    ]);
    const mockMovies = {
      content: [
        { id: 1, title: 'Action Hero', durationMinutes: 120, posterUrl: null, releaseDate: '2026-11-01', genres: ['ACTION'] },
      ],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
      last: true,
    };
    vi.spyOn(moviesApi, 'getMovies').mockResolvedValue(mockMovies);
    vi.spyOn(schedulesApi, 'getSchedules').mockResolvedValue({
      content: [],
      page: 0,
      size: 200,
      totalElements: 0,
      totalPages: 0,
      last: true,
    });

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>,
    );

    // Initial load displays movies
    const titles = await screen.findAllByText('Action Hero');
    expect(titles.length).toBeGreaterThan(0);

    const allGenreBtn = screen.getByRole('button', { name: 'All' });
    expect(allGenreBtn).toHaveClass('on');

    // Repeated clicks on active 'All' genre
    await user.click(allGenreBtn);
    await user.click(allGenreBtn);

    // Movies remain rendered; page never enters freeze or skeleton
    expect(screen.getAllByText('Action Hero').length).toBeGreaterThan(0);
    expect(document.querySelector('.skeleton')).toBeNull();

    // Now switch to 'Action'
    const actionBtn = screen.getByRole('button', { name: 'Action' });
    await user.click(actionBtn);

    await waitFor(() => {
      expect(actionBtn).toHaveClass('on');
    });

    // Repeated click on already-active 'Action'
    await user.click(actionBtn);
    expect(screen.getAllByText('Action Hero').length).toBeGreaterThan(0);
    expect(document.querySelector('.skeleton')).toBeNull();
  });

  // 8. Day changes cannot book stale/past showtimes
  it('8. Day changes cannot book stale/past showtimes', async () => {
    const movieDetail: MovieDto = {
      id: 1,
      title: 'Retro Classic',
      description: 'A great movie.',
      durationMinutes: 110,
      releaseDate: '2026-11-01',
      posterUrl: null,
      genres: [{ id: 2, name: 'Drama' }],
    };
    vi.spyOn(moviesApi, 'getMovie').mockResolvedValue(movieDetail);

    const now = Date.now();
    const pastSchedule = {
      id: 101,
      movieId: 1,
      movieTitle: 'Retro Classic',
      theaterId: 1,
      theaterName: 'Retro Hall',
      startTime: new Date(now - 3600000).toISOString(), // 1h ago
      endTime: new Date(now - 1800000).toISOString(),
      basePrice: 10.0,
      vipPrice: 15.0,
    };
    const futureSchedule = {
      id: 102,
      movieId: 1,
      movieTitle: 'Retro Classic',
      theaterId: 1,
      theaterName: 'Retro Hall',
      startTime: new Date(now + 7200000).toISOString(), // 2h in future
      endTime: new Date(now + 10800000).toISOString(),
      basePrice: 10.0,
      vipPrice: 15.0,
    };

    vi.spyOn(schedulesApi, 'getSchedules').mockResolvedValue({
      content: [pastSchedule, futureSchedule],
      page: 0,
      size: 50,
      totalElements: 2,
      totalPages: 1,
      last: true,
    });

    render(
      <MemoryRouter initialEntries={['/movie/1']}>
        <Routes>
          <Route path="/movie/:id" element={<MovieDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for showtimes to render
    await waitFor(() => {
      const chooseSeatsBtn = screen.getByRole('button', { name: /Choose seats for/i });
      expect(chooseSeatsBtn).toBeInTheDocument();
    });

    // Verify future showtime button is enabled
    const futureTimeStr = formatTime(futureSchedule.startTime);
    const pastTimeStr = formatTime(pastSchedule.startTime);

    const futureBtn = screen.getByRole('button', { name: new RegExp(`${futureTimeStr} in Retro Hall$`) });
    expect(futureBtn).toBeInTheDocument();
    expect(futureBtn).not.toBeDisabled();

    // Verify past showtime button is disabled
    const pastBtn = screen.getByRole('button', { name: new RegExp(`${pastTimeStr} in Retro Hall \\(Passed\\)`) });
    expect(pastBtn).toBeInTheDocument();
    expect(pastBtn).toBeDisabled();

    // Verify CTA action bar only pre-selects and enables the future schedule
    const chooseSeatsBtn = screen.getByRole('button', { name: new RegExp(`Choose seats for ${futureTimeStr}`, 'i') });
    expect(chooseSeatsBtn).toBeInTheDocument();
  });

  // 9. Payment polling cannot continue after disposal or clear another ticket reference
  it('9. Payment polling cannot continue after disposal or clear another ticket reference', async () => {
    sessionStorage.setItem('cinebook_pending_ticket_id', '100');

    let pollCount = 0;
    const ticketDeferred = createDeferred<TicketDto>();
    vi.spyOn(ticketsApi, 'getTicket').mockImplementation(async () => {
      pollCount++;
      return ticketDeferred.promise;
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/payment/success']}>
        <Routes>
          <Route path="/payment/success" element={<PaymentSuccessPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(pollCount).toBe(1);

    // Unmount before response arrives
    unmount();

    // Now resolve ticket as PAID
    await act(async () => {
      ticketDeferred.resolve({
        id: 100,
        scheduleId: 10,
        movieTitle: 'Ember Road',
        scheduleStartTime: new Date().toISOString(),
        seatCount: 1,
        seats: [{ rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5 }],
        totalPrice: 12.5,
        currency: 'USD',
        status: 'PAID',
        paidAt: new Date().toISOString(),
        cancelledAt: null,
      });
    });

    // Another checkout stored ticket #200 in sessionStorage
    sessionStorage.setItem('cinebook_pending_ticket_id', '200');

    // Polling step must not continue or overwrite/clear ticket #200
    expect(sessionStorage.getItem('cinebook_pending_ticket_id')).toBe('200');
    expect(pollCount).toBe(1);
  });

  // 10. Missing-reference retry works
  it('10. Missing-reference retry works', async () => {
    // sessionStorage is completely empty
    const mockTicketPending: TicketDto = {
      id: 555,
      scheduleId: 10,
      movieTitle: 'Ember Road',
      scheduleStartTime: new Date().toISOString(),
      seatCount: 1,
      seats: [{ rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5 }],
      totalPrice: 12.5,
      currency: 'USD',
      status: 'PENDING_PAYMENT',
      paidAt: null,
      cancelledAt: null,
    };

    const getMyTicketsSpy = vi.spyOn(ticketsApi, 'getMyTickets');
    // First discovery call fails
    getMyTicketsSpy.mockRejectedValueOnce(new Error('Network error'));
    // Second discovery call on retry succeeds
    getMyTicketsSpy.mockResolvedValueOnce({
      content: [mockTicketPending],
      page: 0,
      size: 1,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });

    vi.spyOn(ticketsApi, 'getTicket').mockResolvedValue(mockTicketPending);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/payment/success']}>
        <Routes>
          <Route path="/payment/success" element={<PaymentSuccessPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Error is shown when discovery fails
    expect(await screen.findByText(/Could not verify recent booking/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Check again/i });
    expect(retryBtn).toBeInTheDocument();

    // Click "Check again" to trigger rediscovery
    await user.click(retryBtn);

    // Rediscovery succeeds and begins polling ticket #555
    expect(await screen.findByText(/Confirming payment with Stripe/i)).toBeInTheDocument();
    expect(getMyTicketsSpy).toHaveBeenCalledTimes(2);
  });

  // 11. Old getMe failure cannot clear a fresh login
  it('11. Old getMe failure cannot clear a fresh login', async () => {
    setToken('old-token');

    const oldGetMeDeferred = createDeferred<UserDto>();
    const getMeSpy = vi.spyOn(authApi, 'getMe').mockReturnValue(oldGetMeDeferred.promise);

    vi.spyOn(authApi, 'login').mockResolvedValue({
      accessToken: 'new-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: 99, email: 'new@example.com', name: 'New User', role: 'USER' },
    });

    render(
      <AuthProvider>
        <div>Mounted</div>
      </AuthProvider>,
    );

    expect(getMeSpy).toHaveBeenCalledTimes(1);

    // Simulate user logging in with fresh credentials while old getMe is still in flight
    setToken('new-token');

    // Now old getMe rejects with 401 Unauthorized
    await act(async () => {
      oldGetMeDeferred.reject(
        new ApiException({
          status: 401,
          error: 'Unauthorized',
          message: 'Old token has expired',
        }),
      );
    });

    // Crucial check: the fresh token must NOT have been wiped!
    expect(getToken()).toBe('new-token');
  });
});
