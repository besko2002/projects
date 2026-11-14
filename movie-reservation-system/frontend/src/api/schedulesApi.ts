import { request } from './client';
import type { PageResponse } from '../types/api';
import type { ScheduleDto, ScheduleSummary } from '../types/schedule';

export interface ScheduleQueryParams {
  movieId?: number;
  theaterId?: number;
  date?: string; // YYYY-MM-DD
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
  page?: number;
  size?: number;
}

export async function getSchedules(
  params: ScheduleQueryParams = {},
): Promise<PageResponse<ScheduleSummary>> {
  const search = new URLSearchParams();
  if (params.movieId !== undefined) search.set('movieId', String(params.movieId));
  if (params.theaterId !== undefined) search.set('theaterId', String(params.theaterId));
  if (params.date) search.set('date', params.date);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.size !== undefined) search.set('size', String(params.size));

  const query = search.toString();
  return request<PageResponse<ScheduleSummary>>(`/api/schedules${query ? `?${query}` : ''}`);
}

export async function getSchedule(id: number): Promise<ScheduleDto> {
  return request<ScheduleDto>(`/api/schedules/${id}`);
}
