import { request } from './client';
import type { PageResponse } from '../types/api';
import type { GenreDto, MovieDto } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import type {
  AdminTicket,
  CreateMoviePayload,
  CreateSchedulePayload,
  CreateTheaterPayload,
  OccupancyReport,
  RevenueReport,
  TheaterDto,
  TheaterSummary,
  UpdateMoviePayload,
} from '../types/admin';

export interface AuthConfig {
  googleClientId?: string | null;
  passwordResetEnabled: boolean;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    return await request<AuthConfig>('/api/auth/config');
  } catch {
    return { googleClientId: null, passwordResetEnabled: false };
  }
}

// --- Movies ---
export async function createMovie(payload: CreateMoviePayload): Promise<MovieDto> {
  return request<MovieDto>('/api/movies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMovie(id: number, payload: UpdateMoviePayload): Promise<MovieDto> {
  return request<MovieDto>(`/api/movies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteMovie(id: number): Promise<void> {
  return request<void>(`/api/movies/${id}`, {
    method: 'DELETE',
  });
}

// --- Genres ---
export async function createGenre(name: string): Promise<GenreDto> {
  return request<GenreDto>('/api/genres', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateGenre(id: number, name: string): Promise<GenreDto> {
  return request<GenreDto>(`/api/genres/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export async function deleteGenre(id: number): Promise<void> {
  return request<void>(`/api/genres/${id}`, {
    method: 'DELETE',
  });
}

// --- Theaters / Halls ---
export async function getTheaters(page = 0, size = 100): Promise<PageResponse<TheaterSummary>> {
  return request<PageResponse<TheaterSummary>>(`/api/theaters?page=${page}&size=${size}`);
}

export async function getTheater(id: number): Promise<TheaterDto> {
  return request<TheaterDto>(`/api/theaters/${id}`);
}

export async function createTheater(payload: CreateTheaterPayload): Promise<TheaterDto> {
  return request<TheaterDto>('/api/theaters', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTheater(id: number, payload: CreateTheaterPayload): Promise<TheaterDto> {
  return request<TheaterDto>(`/api/theaters/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteTheater(id: number): Promise<void> {
  return request<void>(`/api/theaters/${id}`, {
    method: 'DELETE',
  });
}

// --- Schedules ---
export async function createSchedule(payload: CreateSchedulePayload): Promise<ScheduleSummary> {
  return request<ScheduleSummary>('/api/schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteSchedule(id: number): Promise<void> {
  return request<void>(`/api/schedules/${id}`, {
    method: 'DELETE',
  });
}

// --- Reports & Tickets ---
export async function getRevenueReport(from?: string, to?: string): Promise<RevenueReport> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const q = params.toString();
  return request<RevenueReport>(`/api/admin/reports/revenue${q ? `?${q}` : ''}`);
}

export async function getOccupancyReport(scheduleId: number): Promise<OccupancyReport> {
  return request<OccupancyReport>(`/api/admin/reports/occupancy/${scheduleId}`);
}

export interface AdminTicketQueryParams {
  status?: string;
  scheduleId?: number;
  userId?: number;
  page?: number;
  size?: number;
}

export async function getAdminTickets(
  params: AdminTicketQueryParams = {},
): Promise<PageResponse<AdminTicket>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.scheduleId) search.set('scheduleId', String(params.scheduleId));
  if (params.userId) search.set('userId', String(params.userId));
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.size !== undefined) search.set('size', String(params.size));

  const q = search.toString();
  return request<PageResponse<AdminTicket>>(`/api/admin/tickets${q ? `?${q}` : ''}`);
}
