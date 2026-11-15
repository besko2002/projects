import type { MovieSummary } from './movie';

export interface ScheduleSummary {
  id: number;
  movieId: number;
  movieTitle: string;
  theaterId: number;
  theaterName: string;
  startTime: string;
  endTime: string;
  basePrice: number;
  vipPrice: number;
}

export interface ScheduleTheaterDto {
  id: number;
  name: string;
  location: string;
  totalSeats: number;
}

export interface SchedulePricesDto {
  basePrice: number;
  vipPrice: number;
}

export interface ScheduleDto {
  id: number;
  movie: MovieSummary;
  theater: ScheduleTheaterDto;
  startTime: string;
  endTime: string;
  prices: SchedulePricesDto;
}

/** Cinema scheduling settings (GET /api/schedules/settings). */
export interface ScheduleSettings {
  zone: string; // IANA zone the cinema plans showtimes in, e.g. "Africa/Cairo"
  bufferMinutes: number;
}
