import { request } from './client';
import type { PageResponse } from '../types/api';
import type { GenreDto, MovieDto, MovieSummary } from '../types/movie';

export interface MovieQueryParams {
  genre?: string;
  title?: string;
  page?: number;
  size?: number;
}

export async function getMovies(
  params: MovieQueryParams = {},
): Promise<PageResponse<MovieSummary>> {
  const search = new URLSearchParams();
  if (params.genre) search.set('genre', params.genre);
  if (params.title) search.set('title', params.title);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.size !== undefined) search.set('size', String(params.size));

  const query = search.toString();
  return request<PageResponse<MovieSummary>>(`/api/movies${query ? `?${query}` : ''}`);
}

export async function getMovie(id: number): Promise<MovieDto> {
  return request<MovieDto>(`/api/movies/${id}`);
}

export async function getGenres(): Promise<GenreDto[]> {
  return request<GenreDto[]>('/api/genres');
}
