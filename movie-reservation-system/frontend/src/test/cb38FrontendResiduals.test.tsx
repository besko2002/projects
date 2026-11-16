import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../context/AuthContext';
import { useAuth } from '../context/useAuth';
import { TopBar } from '../components/TopBar';
import { MovieCard } from '../components/MovieCard';
import { HomePage } from '../pages/HomePage';
import { AdminShowtimesPage } from '../pages/admin/AdminShowtimesPage';
import * as authApi from '../api/authApi';
import * as adminApi from '../api/adminApi';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';
import { ApiException, setToken } from '../api/client';
import { formatDateShort } from '../utils/dateUtils';

vi.mock('../api/authApi');
vi.mock('../api/adminApi');
vi.mock('../api/moviesApi');
vi.mock('../api/schedulesApi');

const DAY = 86_400_000;

function page<T>(content: T[]) {
  return { content, page: 0, size: 100, totalElements: content.length, totalPages: 1, last: true };
}

/** yyyy-MM-dd of a day `daysAhead` from now in the browser zone (the zone the mocked settings use). */
function browserDay(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  vi.resetAllMocks();
  setToken(null);
});

describe('CB-38: account notice', () => {
  function Controls() {
    const { loginWithGoogle, logout } = useAuth();
    return (
      <>
        <button type="button" onClick={() => void loginWithGoogle?.('google-id-token')}>Simulate Google</button>
        <button type="button" onClick={() => void logout()}>Simulate logout</button>
      </>
    );
  }

  it('does not survive logout', async () => {
    const user = { id: 7, name: 'Linked Patron', email: 'linked@example.com', role: 'USER' as const };
    vi.mocked(authApi.getMe).mockResolvedValue(user);
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    vi.mocked(authApi.loginWithGoogle).mockResolvedValue({
      accessToken: 'jwt-after-link', tokenType: 'Bearer', expiresIn: 3600, user,
      notice: 'Your CineBook account was linked with Google. For security, your previous password was cleared.',
    });
    render(
      <AuthProvider>
        <MemoryRouter>
          <TopBar />
          <Controls />
        </MemoryRouter>
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Simulate Google' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/previous password was cleared/i);

    fireEvent.click(screen.getByRole('button', { name: 'Simulate logout' }));
    await waitFor(() => expect(authApi.logout).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/previous password was cleared/i)).toBeNull());
  });
});

describe('CB-38: posters', () => {
  it('a poster URL that is already percent-encoded is used exactly as given', () => {
    const url = '/posters/caf%C3%A9 night.svg';
    const { container } = render(
      <MemoryRouter>
        <MovieCard movie={{ id: 3, title: 'Cafe Night', durationMinutes: 95, posterUrl: url, releaseDate: '2026-01-01' }} />
      </MemoryRouter>,
    );
    const img = container.querySelector('img.poster-img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(url);
    expect(container.innerHTML).not.toContain('%25C3');
  });
});

describe('CB-38: featured hero', () => {
  function mockHome(posterUrl: string | null, startsInDays: number) {
    const start = new Date(Date.now() + startsInDays * DAY);
    start.setHours(19, 30, 0, 0);
    vi.mocked(moviesApi.getGenres).mockResolvedValue([]);
    vi.mocked(moviesApi.getMovies).mockResolvedValue(
      page([{ id: 1, title: 'Silver Marquee', durationMinutes: 110, posterUrl, releaseDate: '2026-01-01' }]),
    );
    vi.mocked(moviesApi.getMovie).mockResolvedValue({
      id: 1, title: 'Silver Marquee', description: 'A night at the pictures.', durationMinutes: 110,
      posterUrl, releaseDate: '2026-01-01', genres: [],
    });
    vi.mocked(schedulesApi.getSchedules).mockResolvedValue(page([{
      id: 55, movieId: 1, movieTitle: 'Silver Marquee', theaterId: 2, theaterName: 'Grand Hall',
      startTime: start.toISOString(), endTime: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
      basePrice: 10, vipPrice: 15,
    }]));
    return start;
  }

  it('a showtime several days ahead names its day next to the time', async () => {
    const start = mockHome('/posters/silver.svg', 5);
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const board = await screen.findByLabelText('Featured Showtime Details');
    await waitFor(() => expect(board).toHaveTextContent(/GRAND HALL/));
    expect(board).not.toHaveTextContent(/^UPCOMING/);
    expect(board).toHaveTextContent(formatDateShort(start.toISOString()).toUpperCase());
  });

  it('without a poster the title is shown once, as the heading', async () => {
    mockHome(null, 1);
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const hero = await screen.findByRole('region', { name: 'Featured Movie' });
    await within(hero).findByRole('heading', { name: 'Silver Marquee' });
    expect(within(hero).getAllByText('Silver Marquee')).toHaveLength(1);
  });
});

describe('CB-38: bulk scheduler', () => {
  function mockAdmin() {
    vi.mocked(moviesApi.getMovies).mockResolvedValue(
      page([{ id: 1, title: 'Casablanca', durationMinutes: 102, posterUrl: null, releaseDate: '1942-11-26' }]),
    );
    vi.mocked(adminApi.getTheaters).mockResolvedValue(
      page([{ id: 10, name: 'Classic Hall', location: 'Main', totalRows: 10, seatsPerRow: 10, totalSeats: 100 }]),
    );
    vi.mocked(schedulesApi.getSchedules).mockResolvedValue(page([]));
  }

  async function openBulk() {
    render(<MemoryRouter><AdminShowtimesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Open bulk recurring scheduler/i }));
    await screen.findByRole('option', { name: /Casablanca/i });
  }

  function fill(start: string, end: string, times: string) {
    fireEvent.change(screen.getByLabelText(/Start Date \*/i), { target: { value: start } });
    fireEvent.change(screen.getByLabelText(/End Date \*/i), { target: { value: end } });
    fireEvent.change(screen.getByLabelText(/Showtimes of Day/i), { target: { value: times } });
  }

  it('refuses to schedule when the cinema zone cannot be loaded, and says so', async () => {
    mockAdmin();
    vi.mocked(schedulesApi.getScheduleSettings).mockRejectedValue(new Error('network down'));
    await openBulk();
    fill(browserDay(10), browserDay(10), '12:00');

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the cinema time zone/i);
    const run = screen.getByRole('button', { name: /Run Bulk Generation/i });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(adminApi.createSchedule).not.toHaveBeenCalled();

    vi.mocked(schedulesApi.getScheduleSettings).mockResolvedValue({ zone: BROWSER_ZONE, bufferMinutes: 15 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Bulk Generation/i })).toBeEnabled());
  });

  it('rejects an impossible time such as 25:99 without calling the API', async () => {
    mockAdmin();
    vi.mocked(schedulesApi.getScheduleSettings).mockResolvedValue({ zone: BROWSER_ZONE, bufferMinutes: 15 });
    await openBulk();
    fill(browserDay(10), browserDay(10), '12:00, 25:99');
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Bulk Generation/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Run Bulk Generation/i }));

    expect(await screen.findByText(/Invalid time format: "25:99"/)).toBeInTheDocument();
    expect(adminApi.createSchedule).not.toHaveBeenCalled();
  });

  it('rejects an end date before the start date without calling the API', async () => {
    mockAdmin();
    vi.mocked(schedulesApi.getScheduleSettings).mockResolvedValue({ zone: BROWSER_ZONE, bufferMinutes: 15 });
    await openBulk();
    fill(browserDay(12), browserDay(10), '12:00');
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Bulk Generation/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Run Bulk Generation/i }));

    expect(await screen.findByText(/End Date cannot be before Start Date/i)).toBeInTheDocument();
    expect(adminApi.createSchedule).not.toHaveBeenCalled();
  });

  it('stops calling the API after a 401', async () => {
    mockAdmin();
    vi.mocked(schedulesApi.getScheduleSettings).mockResolvedValue({ zone: BROWSER_ZONE, bufferMinutes: 15 });
    vi.mocked(adminApi.createSchedule).mockRejectedValue(
      new ApiException({ status: 401, error: 'Unauthorized', message: 'Session expired' }),
    );
    await openBulk();
    fill(browserDay(10), browserDay(12), '12:00, 18:00'); // 6 slots
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Bulk Generation/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Run Bulk Generation/i }));

    await screen.findByTestId('bulk-results-panel');
    expect(adminApi.createSchedule).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Session expired \(401\)/i)).toBeInTheDocument();
  });
});
