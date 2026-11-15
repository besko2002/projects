import React, { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { DateSelector } from '../components/DateSelector';
import { GenreChips } from '../components/GenreChips';
import { MovieCard } from '../components/MovieCard';
import type { GenreDto, MovieSummary } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';
import { formatDuration, formatTime, getUpcomingDays } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

export function HomePage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const days = useMemo(() => getUpcomingDays(7), []);
  const [selectedDate, setSelectedDate] = useState<string>(days[0]?.dateString ?? '');
  const [genres, setGenres] = useState<GenreDto[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams.get('q') || '');
  const [referenceTime] = useState<number>(() => Date.now());

  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);

  const handleSelectGenre = (genre: string | null) => {
    setSelectedGenre(genre);
    setLoading(true);
  };

  // Load genres and movies with ignore flag and genre filter (P2-3, P2-4)
  useEffect(() => {
    let ignore = false;
    Promise.all([
      moviesApi.getGenres(),
      moviesApi.getMovies({ genre: selectedGenre ?? undefined, size: 100 }),
    ])
      .then(([genresData, moviesData]) => {
        if (!ignore) {
          setGenres(genresData);
          setMovies(moviesData.content);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setCatalogueError(err instanceof Error ? err.message : 'Failed to load movie catalogue');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedGenre]);

  // Load schedules using local day bounds (P2-2, P2-3)
  useEffect(() => {
    let ignore = false;
    if (!selectedDate) return;

    // Compute user's local midnight start and next midnight end
    const [y, m, d] = selectedDate.split('-').map(Number);
    const localStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const localEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    schedulesApi
      .getSchedules({
        from: localStart.toISOString(),
        to: localEnd.toISOString(),
        size: 100,
      })
      .then((data) => {
        if (!ignore) {
          setSchedules(data.content);
          setSchedulesError(null);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setSchedulesError(err instanceof Error ? err.message : 'Failed to load showtimes');
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedDate]);

  // Map schedules by movieId (filtering out already-started shows for booking - P2-2)
  const schedulesByMovie = useMemo(() => {
    const map = new Map<number, ScheduleSummary[]>();
    for (const s of schedules) {
      const list = map.get(s.movieId) || [];
      list.push(s);
      map.set(s.movieId, list);
    }
    return map;
  }, [schedules]);

  // Client-side search filtering (backend already filtered by genre)
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

  // Featured banner movie: prioritize first active movie
  const featuredMovie = useMemo(() => {
    return filteredMovies[0] || movies[0] || null;
  }, [filteredMovies, movies]);

  const featuredSchedules = useMemo(() => {
    if (!featuredMovie) return [];
    const list = schedulesByMovie.get(featuredMovie.id) || [];
    // Prioritize upcoming showtimes
    return list.filter((s) => new Date(s.startTime).getTime() > referenceTime);
  }, [featuredMovie, schedulesByMovie, referenceTime]);

  const nextFeaturedShowtime = featuredSchedules[0] || null;

  const [todayLabel] = useState<string>(() => {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  });

  return (
    <div className="screen screen-container" id="home">
      <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      <main className="wrap">
        <div className="kicker">{todayLabel}</div>
        <h1>Now playing</h1>

        {catalogueError && (
          <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {catalogueError}
          </div>
        )}

        {schedulesError && (
          <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
            {schedulesError}
          </div>
        )}

        {/* Featured Letter-board Banner */}
        {featuredMovie && (
          <section className="feature" aria-label="Featured Movie">
            <div className="art p1">
              <b>{featuredMovie.title}</b>
            </div>
            <div className="body">
              <div className="board" aria-label="Featured Showtime Details">
                <span>TONIGHT</span>
                {nextFeaturedShowtime && (
                  <>
                    <span>{formatTime(nextFeaturedShowtime.startTime)}</span>
                    <span>{nextFeaturedShowtime.theaterName.toUpperCase()}</span>
                  </>
                )}
              </div>
              <p className="soft">
                Experience the latest cinema release with crystal clear projection and immersive sound.
                <br />
                {formatDuration(featuredMovie.durationMinutes)}
                {selectedGenre && ` · ${selectedGenre}`}
                {nextFeaturedShowtime &&
                  ` · Standard ${formatMoney(nextFeaturedShowtime.basePrice)} · VIP ${formatMoney(nextFeaturedShowtime.vipPrice)}`}
              </p>
              <div className="acts">
                {nextFeaturedShowtime ? (
                  <Link to={`/book/${nextFeaturedShowtime.id}`} className="btn red">
                    Book seats
                  </Link>
                ) : (
                  <Link to={`/movie/${featuredMovie.id}`} className="btn red">
                    Book seats
                  </Link>
                )}
                <Link to={`/movie/${featuredMovie.id}`} className="btn">
                  All showtimes
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Controls: Segmented Day Picker + Genre Pills on one row */}
        <div className="controls">
          <DateSelector
            days={days}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <GenreChips
            genres={genres}
            selectedGenre={selectedGenre}
            onSelectGenre={handleSelectGenre}
          />
        </div>

        {/* 4-Column Ticket Cards Grid */}
        {loading ? (
          <div className="grid" aria-label="Loading movies">
            <div className="ticket skeleton" style={{ height: '380px' }} />
            <div className="ticket skeleton" style={{ height: '380px' }} />
            <div className="ticket skeleton" style={{ height: '380px' }} />
            <div className="ticket skeleton" style={{ height: '380px' }} />
          </div>
        ) : filteredMovies.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-12) var(--space-6)',
              textAlign: 'center',
              border: '3px solid var(--ink)',
              background: 'var(--paper)',
              boxShadow: 'var(--shadow)',
              marginTop: 'var(--space-8)',
            }}
          >
            <h2>No movies match your selection</h2>
            <p className="soft" style={{ marginTop: 'var(--space-2)' }}>
              Try selecting a different genre or date from the controls above.
            </p>
          </div>
        ) : (
          <div className="grid" aria-label="Movies now playing">
            {filteredMovies.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                schedules={schedulesByMovie.get(m.id) || []}
                genresLabel={selectedGenre || undefined}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
