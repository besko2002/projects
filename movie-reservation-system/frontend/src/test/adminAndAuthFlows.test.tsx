import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminGuard } from '../components/AdminGuard';
import { AuthContext } from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SignInPage } from '../pages/SignInPage';
import { AdminMoviesPage } from '../pages/admin/AdminMoviesPage';
import { AdminGenresPage } from '../pages/admin/AdminGenresPage';
import { AdminHallsPage } from '../pages/admin/AdminHallsPage';
import { AdminReportsPage } from '../pages/admin/AdminReportsPage';
import { AdminShowtimesPage } from '../pages/admin/AdminShowtimesPage';
import { getDaysBetween, formatLocalDate } from '../utils/dateUtils';
import * as authApi from '../api/authApi';
import * as adminApi from '../api/adminApi';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';
import { ApiException } from '../api/client';

vi.mock('../api/authApi');
vi.mock('../api/adminApi');
vi.mock('../api/moviesApi');
vi.mock('../api/schedulesApi');

describe('AdminGuard Component', () => {
  it('redirects anonymous visitor to /login with return path', () => {
    const mockAuth: AuthContextValue = {
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter initialEntries={['/admin/movies']}>
          <Routes>
            <Route
              path="/admin/movies"
              element={
                <AdminGuard>
                  <div>Secret Staff Admin Content</div>
                </AdminGuard>
              }
            />
            <Route path="/login" element={<div>Sign In Screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.queryByText('Secret Staff Admin Content')).toBeNull();
    expect(screen.getByText('Sign In Screen')).toBeInTheDocument();
  });

  it('renders 403 Forbidden screen when authenticated user lacks ADMIN role', () => {
    const mockAuth: AuthContextValue = {
      user: {
        id: 42,
        name: 'Regular Customer',
        email: 'customer@cinebook.local',
        role: 'USER',
      },
      token: 'jwt-token',
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter initialEntries={['/admin/movies']}>
          <Routes>
            <Route
              path="/admin/movies"
              element={
                <AdminGuard>
                  <div>Secret Staff Admin Content</div>
                </AdminGuard>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.queryByText('Secret Staff Admin Content')).toBeNull();
    expect(screen.getByText('403 Forbidden')).toBeInTheDocument();
    expect(screen.getByText(/Staff Administration Only/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to Box Office/i })).toBeInTheDocument();
  });

  it('renders children when authenticated user has ADMIN role', () => {
    const mockAuth: AuthContextValue = {
      user: {
        id: 1,
        name: 'Staff Manager',
        email: 'admin@cinebook.local',
        role: 'ADMIN',
      },
      token: 'jwt-token',
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter initialEntries={['/admin/movies']}>
          <Routes>
            <Route
              path="/admin/movies"
              element={
                <AdminGuard>
                  <div>Secret Staff Admin Content</div>
                </AdminGuard>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByText('Secret Staff Admin Content')).toBeInTheDocument();
  });
});

describe('Password Reset Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getAuthConfig).mockResolvedValue({
      googleClientId: null,
      passwordResetEnabled: true,
    });
  });

  it('ForgotPasswordPage sends forgot password request and shows feedback', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({
      message: 'If the email exists, a password reset link has been dispatched.',
    });

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/Account Email/i);
    const submitBtn = screen.getByRole('button', { name: /Send Reset Link/i });

    fireEvent.change(emailInput, { target: { value: 'alice@cinebook.local' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(authApi.forgotPassword).toHaveBeenCalledWith({ email: 'alice@cinebook.local' });
    });

    expect(await screen.findByText(/Check your inbox/i)).toBeInTheDocument();
  });

  it('ResetPasswordPage validates token and matching passwords', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({
      message: 'Your password has been successfully reset.',
    });

    render(
      <MemoryRouter initialEntries={['/reset-password?token=valid-secret-token']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const passInput = screen.getByLabelText(/^New Password/i);
    const confirmInput = screen.getByLabelText(/Confirm New Password/i);
    const submitBtn = screen.getByRole('button', { name: /Update password/i });

    fireEvent.change(passInput, { target: { value: 'Secret123!' } });
    fireEvent.change(confirmInput, { target: { value: 'DifferentPassword' } });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();

    // Now matching password
    fireEvent.change(confirmInput, { target: { value: 'Secret123!' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(authApi.resetPassword).toHaveBeenCalledWith({
        token: 'valid-secret-token',
        newPassword: 'Secret123!',
      });
    });

    expect(await screen.findByText(/Password Reset Complete/i)).toBeInTheDocument();
  });

  it('ResetPasswordPage reads token from URL fragment (#token=)', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({
      message: 'Your password has been successfully reset.',
    });

    render(
      <MemoryRouter initialEntries={['/reset-password#token=fragment-secret-token']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const passInput = screen.getByLabelText(/^New Password/i);
    const confirmInput = screen.getByLabelText(/Confirm New Password/i);
    const submitBtn = screen.getByRole('button', { name: /Update password/i });

    fireEvent.change(passInput, { target: { value: 'Secret123!' } });
    fireEvent.change(confirmInput, { target: { value: 'Secret123!' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(authApi.resetPassword).toHaveBeenCalledWith({
        token: 'fragment-secret-token',
        newPassword: 'Secret123!',
      });
    });

    expect(await screen.findByText(/Password Reset Complete/i)).toBeInTheDocument();
  });
});

describe('SignInPage Enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getAuthConfig).mockResolvedValue({
      googleClientId: null,
      passwordResetEnabled: true,
    });
  });

  it('renders Forgot Password link', async () => {
    const mockAuth: AuthContextValue = {
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter>
          <SignInPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const forgotLink = await screen.findByRole('link', { name: /Forgot password\?/i });
    expect(forgotLink).toBeInTheDocument();
    expect(forgotLink).toHaveAttribute('href', '/forgot-password');
  });

  it('renders Google sign-in container when googleClientId is configured', async () => {
    vi.mocked(adminApi.getAuthConfig).mockResolvedValue({
      googleClientId: 'mock-google-client-id-12345.apps.googleusercontent.com',
      passwordResetEnabled: true,
    });

    const mockAuth: AuthContextValue = {
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter>
          <SignInPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const googleBtnContainer = await screen.findByLabelText(/Continue with Google/i);
    expect(googleBtnContainer).toBeInTheDocument();
    expect(screen.getByText('OR')).toBeInTheDocument();
  });

  it('does not render Google sign-in container when googleClientId is null', async () => {
    vi.mocked(adminApi.getAuthConfig).mockResolvedValue({
      googleClientId: null,
      passwordResetEnabled: true,
    });

    const mockAuth: AuthContextValue = {
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter>
          <SignInPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await screen.findByRole('link', { name: /Forgot password\?/i });
    expect(screen.queryByLabelText(/Continue with Google/i)).toBeNull();
    expect(screen.queryByText('OR')).toBeNull();
  });
});

describe('CB-5: Timezone-Safe Bulk Scheduler & Slot Results', () => {
  it('getDaysBetween produces inclusive local date list without day regression', () => {
    const days = getDaysBetween('2026-11-16', '2026-11-18');
    expect(days).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
  });

  it('formatLocalDate correctly formats dates as YYYY-MM-DD', () => {
    const d = new Date(2026, 10, 16, 23, 45, 0);
    expect(formatLocalDate(d)).toBe('2026-11-16');
  });

  it('AdminShowtimesPage bulk scheduler creates slots, reports conflict and error details', async () => {
    vi.mocked(moviesApi.getMovies).mockResolvedValue({
      content: [
        {
          id: 1,
          title: 'Casablanca',
          durationMinutes: 102,
          posterUrl: null,
          releaseDate: '1942-11-26',
        },
      ],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });

    vi.mocked(adminApi.getTheaters).mockResolvedValue({
      content: [
        {
          id: 10,
          name: 'Classic Hall',
          location: 'Main',
          totalRows: 10,
          seatsPerRow: 10,
          totalSeats: 100,
        },
      ],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });

    vi.mocked(schedulesApi.getSchedules).mockResolvedValue({
      content: [],
      page: 0,
      size: 100,
      totalElements: 0,
      totalPages: 1,
      last: true,
    });

    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 10);
    const date1 = new Date(baseDate);
    const date2 = new Date(baseDate);
    date2.setDate(date2.getDate() + 2);
    const d1Str = date1.toISOString().slice(0, 10);
    const d2Str = date2.toISOString().slice(0, 10);

    // Mock createSchedule to succeed on call 1, fail with 409 Conflict on call 2, and 403 Forbidden on call 3
    vi.mocked(adminApi.createSchedule)
      .mockResolvedValueOnce({
        id: 101,
        movieId: 1,
        movieTitle: 'Casablanca',
        theaterId: 10,
        theaterName: 'Classic Hall',
        startTime: `${d1Str}T12:00:00Z`,
        endTime: `${d1Str}T13:42:00Z`,
        basePrice: 10.0,
        vipPrice: 15.0,
      })
      .mockRejectedValueOnce(
        new ApiException({
          status: 409,
          error: 'Conflict',
          message: 'Auditorium occupied at this time',
        }),
      )
      .mockRejectedValueOnce(
        new ApiException({
          status: 403,
          error: 'Forbidden',
          message: 'Staff credentials expired',
        }),
      );

    render(
      <MemoryRouter>
        <AdminShowtimesPage />
      </MemoryRouter>,
    );

    // Wait for initial data to load
    await waitFor(() => {
      expect(moviesApi.getMovies).toHaveBeenCalled();
      expect(adminApi.getTheaters).toHaveBeenCalled();
    });

    // Open bulk scheduler
    const bulkOpenBtn = await screen.findByRole('button', { name: /Open bulk recurring scheduler/i });
    fireEvent.click(bulkOpenBtn);

    // Wait for movie and auditorium options to be available
    const movieSelect = screen.getByLabelText(/Film to Schedule \*/i);
    await screen.findByRole('option', { name: /Casablanca/i });

    const theaterSelect = screen.getByLabelText(/^Auditorium \*/i);
    await screen.findByRole('option', { name: /Classic Hall \(100 seats\)/i });

    const startDateInput = screen.getByLabelText(/Start Date \*/i);
    const endDateInput = screen.getByLabelText(/End Date \*/i);
    const timesInput = screen.getByLabelText(/Showtimes of Day/i);

    fireEvent.change(movieSelect, { target: { value: '1' } });
    fireEvent.change(theaterSelect, { target: { value: '10' } });
    fireEvent.change(startDateInput, { target: { value: d1Str } });
    fireEvent.change(endDateInput, { target: { value: d2Str } });
    fireEvent.change(timesInput, { target: { value: '12:00' } }); // 3 slots total: d1, d1+1, d2 at 12:00

    const submitBtn = screen.getByRole('button', { name: /Run Bulk Generation/i });
    fireEvent.click(submitBtn);

    // Wait for bulk-results-panel report
    const reportPanel = await screen.findByTestId('bulk-results-panel');
    expect(reportPanel).toBeInTheDocument();
    expect(screen.getByText(/Bulk Schedule Slot Report \(3 slots processed\)/i)).toBeInTheDocument();

    // Verify createSchedule received the expected payload with relative startTime
    const expectedFirstStartTime = new Date(`${d1Str}T12:00:00`).toISOString();
    expect(adminApi.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        movieId: 1,
        theaterId: 10,
        startTime: expectedFirstStartTime,
      }),
    );

    // Verify outcomes: created, conflict, error
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('conflict')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('Auditorium occupied (time conflict)')).toBeInTheDocument();
    expect(screen.getByText(/Permission error \(403\)/i)).toBeInTheDocument();

    // Dismiss report
    const dismissBtn = screen.getByRole('button', { name: /Dismiss Report/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('bulk-results-panel')).toBeNull();
  });
});

describe('Admin CRUD Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AdminMoviesPage lists films and submits new movie', async () => {
    vi.mocked(moviesApi.getMovies).mockResolvedValue({
      content: [
        {
          id: 1,
          title: 'Casablanca',
          durationMinutes: 102,
          posterUrl: null,
          releaseDate: '1942-11-26',
        },
      ],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });

    vi.mocked(moviesApi.getGenres).mockResolvedValue([
      { id: 1, name: 'Drama' },
    ]);

    vi.mocked(adminApi.createMovie).mockResolvedValue({
      id: 2,
      title: 'Citizen Kane',
      description: 'Orson Welles masterpiece',
      posterUrl: null,
      durationMinutes: 119,
      releaseDate: '1941-05-01',
      genres: [{ id: 1, name: 'Drama' }],
    });

    render(
      <MemoryRouter>
        <AdminMoviesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Casablanca')).toBeInTheDocument();

    const addBtn = screen.getByRole('button', { name: /Add new movie to catalogue/i });
    fireEvent.click(addBtn);

    const titleInput = screen.getByLabelText(/Film Title \*/i);
    const durationInput = screen.getByLabelText(/Running Time \(minutes\) \*/i);

    fireEvent.change(titleInput, { target: { value: 'Citizen Kane' } });
    fireEvent.change(durationInput, { target: { value: '119' } });

    const submitBtn = screen.getByRole('button', { name: /Add to Catalogue/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(adminApi.createMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Citizen Kane',
          durationMinutes: 119,
        }),
      );
    });
  });

  it('AdminGenresPage lists genres and creates new genre', async () => {
    vi.mocked(moviesApi.getGenres).mockResolvedValue([
      { id: 1, name: 'Film Noir' },
    ]);

    vi.mocked(adminApi.createGenre).mockResolvedValue({
      id: 2,
      name: 'Sci-Fi Thriller',
    });

    render(
      <MemoryRouter>
        <AdminGenresPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Film Noir')).toBeInTheDocument();

    const addBtn = screen.getByRole('button', { name: /Create new genre/i });
    fireEvent.click(addBtn);

    const nameInput = screen.getByLabelText(/Genre Name \*/i);
    fireEvent.change(nameInput, { target: { value: 'Sci-Fi Thriller' } });

    const saveBtn = screen.getByRole('button', { name: /Create Genre/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(adminApi.createGenre).toHaveBeenCalledWith('Sci-Fi Thriller');
    });
  });

  it('AdminHallsPage lists halls and creates new hall', async () => {
    vi.mocked(adminApi.getTheaters).mockResolvedValue({
      content: [
        {
          id: 1,
          name: 'Palace 1',
          location: 'Floor 1',
          totalRows: 8,
          seatsPerRow: 10,
          totalSeats: 80,
        },
      ],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
      last: true,
    });

    vi.mocked(adminApi.createTheater).mockResolvedValue({
      id: 2,
      name: 'Palace 2',
      location: 'Floor 2',
      totalRows: 10,
      seatsPerRow: 12,
      totalSeats: 120,
      vipRows: ['A', 'B'],
    });

    render(
      <MemoryRouter>
        <AdminHallsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Palace 1')).toBeInTheDocument();

    const addBtn = screen.getByRole('button', { name: /Create new auditorium/i });
    fireEvent.click(addBtn);

    const nameInput = screen.getByLabelText(/Auditorium Name \*/i);
    fireEvent.change(nameInput, { target: { value: 'Palace 2' } });

    const saveBtn = screen.getByRole('button', { name: /Create Hall/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(adminApi.createTheater).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Palace 2',
        }),
      );
    });
  });

  it('AdminReportsPage renders revenue report metrics', async () => {
    vi.mocked(schedulesApi.getSchedules).mockResolvedValue({
      content: [],
      page: 0,
      size: 100,
      totalElements: 0,
      totalPages: 1,
      last: true,
    });

    vi.mocked(adminApi.getRevenueReport).mockResolvedValue({
      from: '2026-10-01',
      to: '2026-11-01',
      currency: 'USD',
      paidTickets: 120,
      grossRevenue: 2400.0,
      refundedTickets: 5,
      refundedAmount: 100.0,
      netRevenue: 2300.0,
      byMovie: [
        {
          movieId: 1,
          title: 'Inception',
          tickets: 1,
          revenue: 10.0,
        },
      ],
      byDay: [
        {
          date: '2026-10-15',
          tickets: 1,
          revenue: 10.0,
        },
      ],
    });

    render(
      <MemoryRouter>
        <AdminReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('$2,400.00')).toBeInTheDocument();
    expect(screen.getByText('$2,300.00')).toBeInTheDocument();
    expect(screen.getByText(/100\.00/)).toBeInTheDocument();
    expect(screen.getByText('Inception')).toBeInTheDocument();
    expect(screen.queryByText('$NaN')).toBeNull();
  });
});
