import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminShowtimesPage } from '../pages/admin/AdminShowtimesPage';
import * as adminApi from '../api/adminApi';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';

vi.mock('../api/adminApi');
vi.mock('../api/moviesApi');
vi.mock('../api/schedulesApi');

// A cinema far from any likely test-runner zone, so browser-zone code cannot pass by accident.
const CINEMA_ZONE = 'Asia/Tokyo'; // UTC+9, no DST

function futureCinemaDate(daysAhead: number): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: CINEMA_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + daysAhead * 86_400_000));
  return date;
}

function emptyPage<T>(content: T[]) {
  return { content, page: 0, size: 100, totalElements: content.length, totalPages: 1, last: true };
}

describe('CB-29: showtimes are planned in the cinema zone, not the browser zone', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(moviesApi.getMovies).mockResolvedValue(
      emptyPage([{ id: 1, title: 'Casablanca', durationMinutes: 102, posterUrl: null, releaseDate: '1942-11-26' }]),
    );
    vi.mocked(adminApi.getTheaters).mockResolvedValue(
      emptyPage([{ id: 10, name: 'Classic Hall', location: 'Main', totalRows: 10, seatsPerRow: 10, totalSeats: 100 }]),
    );
    vi.mocked(schedulesApi.getSchedules).mockResolvedValue(emptyPage([]));
    vi.mocked(schedulesApi.getScheduleSettings).mockResolvedValue({ zone: CINEMA_ZONE, bufferMinutes: 15 });
    vi.mocked(adminApi.createSchedule).mockResolvedValue({
      id: 101,
      movieId: 1,
      movieTitle: 'Casablanca',
      theaterId: 10,
      theaterName: 'Classic Hall',
      startTime: '2030-01-01T03:00:00Z',
      endTime: '2030-01-01T04:42:00Z',
      basePrice: 10,
      vipPrice: 15,
    });
  });

  it('bulk scheduler sends 12:00 cinema time as the matching UTC instant and says which zone it uses', async () => {
    const day = futureCinemaDate(10);
    render(
      <MemoryRouter>
        <AdminShowtimesPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(schedulesApi.getScheduleSettings).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: /Open bulk recurring scheduler/i }));
    await screen.findByRole('option', { name: /Casablanca/i });
    await screen.findByText(/Times are cinema time \(Asia\/Tokyo\)/i);

    fireEvent.change(screen.getByLabelText(/Start Date \*/i), { target: { value: day } });
    fireEvent.change(screen.getByLabelText(/End Date \*/i), { target: { value: day } });
    fireEvent.change(screen.getByLabelText(/Showtimes of Day/i), { target: { value: '12:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Run Bulk Generation/i }));

    await screen.findByTestId('bulk-results-panel');
    // 12:00 in Tokyo (UTC+9) is 03:00 UTC on the same date, whatever zone this test runs in.
    expect(adminApi.createSchedule).toHaveBeenCalledTimes(1);
    expect(adminApi.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ movieId: 1, theaterId: 10, startTime: `${day}T03:00:00.000Z` }),
    );
  });
});
