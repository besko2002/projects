export interface GenreDto {
  id: number;
  name: string;
}

export interface MovieSummary {
  id: number;
  title: string;
  posterUrl: string | null;
  durationMinutes: number;
  releaseDate: string;
}

export interface MovieDto {
  id: number;
  title: string;
  description: string;
  posterUrl: string | null;
  durationMinutes: number;
  releaseDate: string;
  genres: GenreDto[];
}
