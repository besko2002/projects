import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SeatSelectionPage } from '../pages/SeatSelectionPage';
import { AuthProvider } from '../context/AuthContext';
import { AuthContext, useAuth } from '../context/useAuth';
import * as schedulesApi from '../api/schedulesApi';
import * as seatsApi from '../api/seatsApi';
import { getToken, setToken } from '../api/client';
import type { ScheduleDto } from '../types/schedule';
import type { SeatMapDto, SeatReservationDto } from '../types/seat';

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

describe('Issue 1: Expired session recovery and resilient auth loading', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setToken(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Expired stored token triggers 401 via client, clears token, and displays sign-in view without permanent skeleton', async () => {
    setToken('expired-session-token');
    expect(getToken()).toBe('expired-session-token');

    // Stub global fetch so actual client.ts request() executes
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/users/me')) {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 401, error: 'Unauthorized', message: 'JWT expired' }),
          text: async () => JSON.stringify({ status: 401, error: 'Unauthorized', message: 'JWT expired' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    function TestApp() {
      const { user, isLoading } = useAuth();
      if (isLoading) {
        return <div data-testid="auth-skeleton">Loading session...</div>;
      }
      if (!user) {
        return (
          <div data-testid="guest-view">
            <h1>Sign in to CineBook</h1>
            <button type="button">Sign In</button>
          </div>
        );
      }
      return <div data-testid="authenticated-view">Hello {user.name}</div>;
    }

    render(
      <AuthProvider>
        <TestApp />
      </AuthProvider>,
    );

    // Skeleton must finish and NOT hang indefinitely
    await waitFor(() => {
      expect(screen.queryByTestId('auth-skeleton')).not.toBeInTheDocument();
    });

    // Guest sign-in recovery view must appear
    expect(screen.getByTestId('guest-view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();

    // Expired token must have been cleared
    expect(getToken()).toBeNull();
  });

  it('2. New login while old bootstrap is pending retains new session when old bootstrap fails with 401', async () => {
    setToken('old-bootstrap-token');

    const deferredOldBootstrap = createDeferred<Response>();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/users/me')) {
        return deferredOldBootstrap.promise;
      }
      if (url.includes('/api/auth/login')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            accessToken: 'fresh-new-jwt',
            tokenType: 'Bearer',
            expiresIn: 3600,
            user: { id: 99, email: 'newuser@example.com', name: 'Fresh User', role: 'USER' },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    function TestLoginApp() {
      const { user, token, isLoading, login } = useAuth();
      return (
        <div>
          <span data-testid="loading-state">{isLoading ? 'loading' : 'ready'}</span>
          <span data-testid="token-state">{token ?? 'none'}</span>
          <span data-testid="user-state">{user ? user.name : 'guest'}</span>
          <button
            type="button"
            onClick={() => login({ email: 'newuser@example.com', password: 'password123' })}
          >
            Do Login
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <TestLoginApp />
      </AuthProvider>,
    );

    // Old bootstrap is pending
    expect(screen.getByTestId('loading-state')).toHaveTextContent('loading');

    // User performs login concurrently
    await user.click(screen.getByRole('button', { name: /Do Login/i }));

    // User is now logged in with fresh token
    expect(screen.getByTestId('token-state')).toHaveTextContent('fresh-new-jwt');
    expect(screen.getByTestId('user-state')).toHaveTextContent('Fresh User');
    expect(getToken()).toBe('fresh-new-jwt');

    // Now old bootstrap request rejects with 401
    await act(async () => {
      deferredOldBootstrap.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 401, error: 'Unauthorized', message: 'Old token has expired' }),
        text: async () => JSON.stringify({ status: 401, error: 'Unauthorized', message: 'Old token has expired' }),
      } as Response);
    });

    // Fresh session must NOT be erased by late old 401 response
    expect(getToken()).toBe('fresh-new-jwt');
    expect(screen.getByTestId('token-state')).toHaveTextContent('fresh-new-jwt');
    expect(screen.getByTestId('user-state')).toHaveTextContent('Fresh User');
    expect(screen.getByTestId('loading-state')).toHaveTextContent('ready');
  });

  it('3. Network and 500 server failures do not erase a valid stored token', async () => {
    setToken('valid-existing-jwt');

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/users/me')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 500, error: 'Internal Server Error', message: 'Database connection failed' }),
          text: async () => JSON.stringify({ status: 500, error: 'Internal Server Error', message: 'Database connection failed' }),
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    function TestApp() {
      const { user, token, isLoading } = useAuth();
      if (isLoading) return <div data-testid="skeleton">Loading...</div>;
      return (
        <div>
          <span data-testid="user">{user ? user.name : 'no-user'}</span>
          <span data-testid="token">{token ?? 'no-token'}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <TestApp />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    });

    // Valid token must remain intact in client storage
    expect(getToken()).toBe('valid-existing-jwt');
  });

  it('4. refreshUser finishes loading and clears token on 401, but preserves valid token on 500', async () => {
    setToken('refresh-token-401');

    let meStatus = 401;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/users/me')) {
        return {
          ok: meStatus < 400,
          status: meStatus,
          statusText: meStatus === 401 ? 'Unauthorized' : 'Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: meStatus, error: 'Auth error', message: 'Auth failed' }),
          text: async () => JSON.stringify({ status: meStatus, error: 'Auth error' }),
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    let authContextValue!: ReturnType<typeof useAuth>;
    function Capture() {
      authContextValue = useAuth();
      return <div>Captured</div>;
    }

    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );

    await waitFor(() => expect(authContextValue.isLoading).toBe(false));
    expect(getToken()).toBeNull();

    // Now test 500 on refreshUser with a valid token
    setToken('another-valid-token');
    meStatus = 500;

    await act(async () => {
      await authContextValue.refreshUser();
    });

    expect(getToken()).toBe('another-valid-token');
    expect(authContextValue.isLoading).toBe(false);
  });
});

describe('Issue 2: Staggered hold expiry failure, disabled checkout & retry reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setToken(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('5. Staggered hold expiry: refresh fails once -> checkout disabled & Retry shown -> retry succeeds -> expired seat removed, valid hold kept, allowance & timer correct', async () => {
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
      expiresAt: new Date(now + 600000).toISOString(), // expires in 10 mins (600s)
    };

    let callCount = 0;
    const getResSpy = vi.spyOn(seatsApi, 'getMyReservations').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [holdA1, holdA2];
      if (callCount === 2) throw new Error('Network error during hold expiry refresh');
      return [holdA2];
    });

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

    // Initial mount effects
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const seatA1 = screen.getByRole('checkbox', { name: /Seat A1/i });
    const seatA2 = screen.getByRole('checkbox', { name: /Seat A2/i });
    const seatA3 = screen.getByRole('checkbox', { name: /Seat A3/i });
    const checkoutBtn = screen.getByRole('button', { name: /Continue to (secure )?payment/i });

    // Both seats initially selected and active
    expect(seatA1).toHaveAttribute('aria-checked', 'true');
    expect(seatA2).toHaveAttribute('aria-checked', 'true');
    expect(checkoutBtn).not.toBeDisabled();
    expect(screen.getByText(/Total · 2 seats/i)).toBeInTheDocument();

    // Advance time past holdA1 expiry (2s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 1. Expiry refresh failed: explicit retryable error banner displayed
    expect(
      screen.getByText(/Network error during hold expiry refresh/i),
    ).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();

    // 2. Checkout button and seat grid must be DISABLED until reconciled
    expect(checkoutBtn).toBeDisabled();
    expect(seatA1).toBeDisabled();
    expect(seatA2).toBeDisabled();
    expect(seatA3).toBeDisabled();

    // 3. User clicks Retry
    await act(async () => {
      retryBtn.click();
      await vi.advanceTimersByTimeAsync(10);
    });

    // 4. Retry succeeded!
    expect(getResSpy).toHaveBeenCalledTimes(3);
    // Ownership error banner is dismissed
    expect(screen.queryByText(/Network error during hold expiry refresh/i)).not.toBeInTheDocument();

    // Expired seat A1 is removed from selection, valid hold A2 is preserved
    expect(seatA1).toHaveAttribute('aria-checked', 'false');
    expect(seatA2).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Total · 1 seat/i)).toBeInTheDocument();

    // Feedback message indicates expired holds released while remaining valid holds kept
    expect(screen.getByText(/Your remaining valid holds are kept/i)).toBeInTheDocument();

    // Checkout button is re-enabled
    expect(checkoutBtn).not.toBeDisabled();

    // Timer recomputed for holdA2: ~597s remaining (formatted ~09:57)
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText(/09:5[67]/)).toBeInTheDocument();

    // Allowance restored: 8 - 1 (held) = 7 available; clicking seatA3 succeeds
    expect(seatA3).not.toBeDisabled();
    await act(async () => {
      seatA3.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(seatA3).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Total · 2 seats/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('6. Does not update state or crash when unmounted during hold expiry reconciliation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });

    vi.spyOn(schedulesApi, 'getSchedule').mockResolvedValue(mockSchedule);
    vi.spyOn(seatsApi, 'getSeatMap').mockResolvedValue(mockSeatMap);

    const holdDeferred = createDeferred<SeatReservationDto[]>();
    const getResSpy = vi.spyOn(seatsApi, 'getMyReservations');
    getResSpy.mockResolvedValueOnce([
      {
        id: 501,
        scheduleId: 10,
        seatId: 101,
        ticketId: null,
        price: 12.5,
        status: 'HELD',
        expiresAt: new Date(Date.now() + 2000).toISOString(),
      },
    ]);
    getResSpy.mockReturnValueOnce(holdDeferred.promise);

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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    // Advance past expiry to trigger reconcileReservations
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Unmount before promise resolves
    unmount();

    // Now resolve deferred
    await act(async () => {
      holdDeferred.resolve([]);
      await vi.advanceTimersByTimeAsync(10);
    });

    vi.useRealTimers();
  });
});
