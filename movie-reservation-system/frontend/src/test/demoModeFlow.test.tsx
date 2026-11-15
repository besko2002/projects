import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { DemoBanner } from '../components/DemoBanner';
import { TopBar } from '../components/TopBar';
import { SignInPage } from '../pages/SignInPage';
import { SeatSelectionPage } from '../pages/SeatSelectionPage';
import { AuthContext, type AuthContextValue } from '../context/useAuth';
import * as schedulesApi from '../api/schedulesApi';
import * as seatsApi from '../api/seatsApi';
import { ApiException } from '../api/client';

vi.mock('../api/schedulesApi');
vi.mock('../api/seatsApi');

describe('Portfolio Reviewer Demo Mode Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const enabledDemoStatus = {
    enabled: true,
    banner: 'Portfolio demo — fictional data, Stripe test payments only.',
    stripeMode: 'test',
  };

  const createAuthValue = (overrides?: Partial<AuthContextValue>): AuthContextValue => ({
    user: null,
    token: null,
    isLoading: false,
    demoStatus: enabledDemoStatus,
    login: vi.fn(),
    register: vi.fn(),
    loginDemo: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    ...overrides,
  });

  it('renders demo banner with reviewer guidance and Stripe test card instructions', async () => {
    const user = userEvent.setup();
    const authVal = createAuthValue();

    render(
      <MemoryRouter>
        <AuthContext.Provider value={authVal}>
          <DemoBanner />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText(/portfolio demo — fictional data, stripe test payments only\./i)).toBeInTheDocument();

    const guideToggle = screen.getByRole('button', { name: /reviewer guide/i });
    expect(guideToggle).toHaveAttribute('aria-expanded', 'false');

    // Expand reviewer guide
    await user.click(guideToggle);
    expect(guideToggle).toHaveAttribute('aria-expanded', 'true');

    expect(screen.getByText(/4242 4242 4242 4242/)).toBeInTheDocument();
    expect(screen.getByText(/never use a real credit card/i)).toBeInTheDocument();
    expect(screen.getByText(/10-minute hold countdown/i)).toBeInTheDocument();
    expect(screen.getByText(/automated refund is available until 2 hours before showtime/i)).toBeInTheDocument();
  });

  it('does not render demo banner when demo mode is disabled', () => {
    const authVal = createAuthValue({ demoStatus: { enabled: false, banner: null, stripeMode: null } });

    const { container } = render(
      <MemoryRouter>
        <AuthContext.Provider value={authVal}>
          <DemoBanner />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders "Try demo" button in TopBar guest navigation when demo is enabled', async () => {
    const user = userEvent.setup();
    const loginDemoMock = vi.fn().mockResolvedValue(undefined);
    const authVal = createAuthValue({ loginDemo: loginDemoMock });

    render(
      <MemoryRouter>
        <AuthContext.Provider value={authVal}>
          <TopBar />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const tryDemoBtn = screen.getByRole('button', { name: /try demo/i });
    expect(tryDemoBtn).toBeInTheDocument();

    await user.click(tryDemoBtn);
    expect(loginDemoMock).toHaveBeenCalledTimes(1);
  });

  it('SignInPage features one-click Try Demo button and navigates to returnUrl', async () => {
    const user = userEvent.setup();
    const loginDemoMock = vi.fn().mockResolvedValue(undefined);
    const authVal = createAuthValue({ loginDemo: loginDemoMock });

    render(
      <MemoryRouter initialEntries={['/login?return=/book/10']}>
        <AuthContext.Provider value={authVal}>
          <Routes>
            <Route path="/login" element={<SignInPage />} />
            <Route path="/book/10" element={<div>Book Schedule 10 Target Screen</div>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const tryDemoBtn = screen.getByRole('button', { name: /try demo session without password/i });
    expect(tryDemoBtn).toBeInTheDocument();

    await user.click(tryDemoBtn);
    expect(loginDemoMock).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Book Schedule 10 Target Screen')).toBeInTheDocument();
  });

  it('displays rate limit error message when demo session creation returns 429', async () => {
    const user = userEvent.setup();
    const loginDemoMock = vi.fn().mockRejectedValue(
      new ApiException({
        status: 429,
        error: 'Too Many Requests',
        message: 'Too many demo sessions created; please wait a moment and try again',
      })
    );
    const authVal = createAuthValue({ loginDemo: loginDemoMock });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthContext.Provider value={authVal}>
          <SignInPage />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const tryDemoBtn = screen.getByRole('button', { name: /try demo session without password/i });
    await user.click(tryDemoBtn);

    expect(await screen.findByText(/too many demo sessions created; please wait a moment and try again/i)).toBeInTheDocument();
  });

  it('restores guest seat selection after Try Demo login redirect', async () => {
    const fakeSchedule = {
      id: 42,
      movieId: 1,
      theater: { id: 1, name: 'Grand Vintage Hall', location: 'Level 1', totalRows: 2, seatsPerRow: 3, totalSeats: 6, vipRows: ['B'] },
      startTime: '2026-11-15T20:00:00Z',
      endTime: '2026-11-15T22:15:00Z',
      basePrice: 14.0,
      vipPrice: 20.0,
      prices: { basePrice: 14.0, vipPrice: 20.0 },
      movie: { id: 1, title: 'Ember Road', durationMinutes: 125, posterUrl: null, releaseDate: '2026-10-14' },
    };

    const fakeSeatMap = {
      scheduleId: 42,
      theaterId: 1,
      startTime: '2026-11-15T20:00:00Z',
      seats: [
        { seatId: 101, rowLabel: 'A', seatNumber: 1, type: 'NORMAL' as const, status: 'AVAILABLE' as const, price: 14.0 },
        { seatId: 102, rowLabel: 'A', seatNumber: 2, type: 'NORMAL' as const, status: 'AVAILABLE' as const, price: 14.0 },
      ],
    };

    vi.mocked(schedulesApi.getSchedule).mockResolvedValue(fakeSchedule);
    vi.mocked(seatsApi.getSeatMap).mockResolvedValue(fakeSeatMap);
    vi.mocked(seatsApi.getMyReservations).mockResolvedValue([]);

    // Prepopulate sessionStorage with saved seats (as if guest selected them and redirected)
    sessionStorage.setItem('cinebook_saved_seats', JSON.stringify({ scheduleId: 42, seatIds: [101] }));

    const authVal = createAuthValue({
      user: { id: 99, name: 'Demo Guest 1234', email: 'demo-1234@demo.cinebook.local', role: 'USER' },
      token: 'jwt-demo-token',
    });

    render(
      <MemoryRouter initialEntries={['/book/42']}>
        <AuthContext.Provider value={authVal}>
          <Routes>
            <Route path="/book/:scheduleId" element={<SeatSelectionPage />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Verify seat 101 was restored and is selected
    await waitFor(() => {
      expect(screen.getByText(/Total · 1 seat/i)).toBeInTheDocument();
      expect(screen.getByText(/A1 · Standard/i)).toBeInTheDocument();
    });
  });
});
