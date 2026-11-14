import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';
import { DateSelector } from '../components/DateSelector';
import { GenreChips } from '../components/GenreChips';
import { MovieCard } from '../components/MovieCard';
import type { GenreDto, MovieSummary } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';
import { formatDuration, getUpcomingDays } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

export function HomePage(): React.JSX.Element {
  const days = useMemo(() => getUpcomingDays(7), []);
  const [selectedDate, setSelectedDate] = useState<string>(days[0]?.dateString ?? '');
  const [genres, setGenres] = useState<GenreDto[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInitial() {
      try {
        const [genresData, moviesData] = await Promise.all([
          moviesApi.getGenres(),
          moviesApi.getMovies({ size: 100 }),
        ]);
        setGenres(genresData);
        setMovies(moviesData.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load catalogue');
      }
    }
    void loadInitial();
  }, []);

  useEffect(() => {
    async function loadSchedules() {
      if (!selectedDate) return;
      try {
        setLoading(true);
        const data = await schedulesApi.getSchedules({
          date: selectedDate,
          size: 100,
        });
        setSchedules(data.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load showtimes');
      } finally {
        setLoading(false);
      }
    }
    void loadSchedules();
  }, [selectedDate]);

  // Map schedules by movieId
  const schedulesByMovie = useMemo(() => {
    const map = new Map<number, ScheduleSummary[]>();
    for (const s of schedules) {
      const list = map.get(s.movieId) || [];
      list.push(s);
      map.set(s.movieId, list);
    }
    return map;
  }, [schedules]);

  // Filter movies
  const filteredMovies = useMemo(() => {
    return movies.filter((m) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!m.title.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [movies, searchQuery]);

  // Featured movie (first movie or Ember Road if present)
  const featuredMovie = useMemo(() => {
    return filteredMovies[0] || movies[0] || null;
  }, [filteredMovies, movies]);

  const featuredSchedules = useMemo(() => {
    if (!featuredMovie) return [];
    return schedulesByMovie.get(featuredMovie.id) || [];
  }, [featuredMovie, schedulesByMovie]);

  return (
    <div className="screen-container">
      <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      <main className="wrap">
        {error && (
          <div className="error-banner" style={{ marginBottom: 'var(--space-6)' }}>
            {error}
          </div>
        )}

        {/* Hero Section */}
        {featuredMovie && (
          <section className="hero" aria-label="Featured Movie and Day Picker">
            <div
              className="feature poster"
              style={{
                background: featuredMovie.posterUrl
                  ? `url(${featuredMovie.posterUrl})`
                  : getPosterGradient(featuredMovie.title),
              }}
            >
              <span className="badge b-pend" style={{ position: 'relative', zIndex: 2 }}>
                FEATURED NOW SHOWING
              </span>
              <div className="ptitle">{featuredMovie.title}</div>
              <p>
                Browse showtimes and reserve premium cinema seats. Full refunds available
                up to 2 hours before showtime. {formatDuration(featuredMovie.durationMinutes)}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', position: 'relative', zIndex: 2 }}>
                <Link to={`/movie/${featuredMovie.id}`} className="btn btn-primary">
                  Book seats
                </Link>
                {featuredSchedules[0] && (
                  <Link
                    to={`/book/${featuredSchedules[0].id}`}
                    className="btn btn-ghost"
                  >
                    Next showtime
                  </Link>
                )}
              </div>
            </div>

            <div>
              <h2>Pick a day</h2>
              <DateSelector
                days={days}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />

              <h2 style={{ marginTop: 'var(--space-6)' }}>Genres</h2>
              <GenreChips
                genres={genres}
                selectedGenre={selectedGenre}
                onSelectGenre={setSelectedGenre}
              />
            </div>
          </section>
        )}

        {/* Section Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'var(--space-8)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <h2>Now showing</h2>
          <span className="muted" style={{ fontSize: '14px' }}>
            {filteredMovies.length} movie(s) · {schedules.length} showtime(s)
          </span>
        </div>

        {/* Movies Grid */}
        {loading && movies.length === 0 ? (
          <div className="grid-movies">
            {[1, 2, 3, 4, 5, 6].map((k) => (
              <div key={k} className="skeleton" style={{ height: '340px' }} />
            ))}
          </div>
        ) : filteredMovies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-12) 0', color: 'var(--ink-soft)' }}>
            No movies match your criteria.
          </div>
        ) : (
          <div className="grid-movies">
            {filteredMovies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                schedules={schedulesByMovie.get(movie.id) || []}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
