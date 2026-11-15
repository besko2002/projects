import React, { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { DateSelector } from '../components/DateSelector';
import { GenreChips } from '../components/GenreChips';
import { MovieCard } from '../components/MovieCard';
import type { GenreDto, MovieDto, MovieSummary } from '../types/movie';
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
  const [loadedGenre, setLoadedGenre] = useState<string | null | undefined>(undefined);
  const [rawSchedules, setRawSchedules] = useState<ScheduleSummary[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);

  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [catalogueRetry, setCatalogueRetry] = useState<number>(0);
  const [schedulesRetry, setSchedulesRetry] = useState<number>(0);

  // Derived loading states without synchronous setState in effects (React 19 / ESLint)
  const loading = (loadedGenre !== selectedGenre && !catalogueError) || loadedGenre === undefined;
  const schedulesLoading = loadedDate !== selectedDate && !schedulesError;
  const schedules = useMemo(() => {
    return loadedDate === selectedDate ? rawSchedules : [];
  }, [loadedDate, selectedDate, rawSchedules]);

  const handleSelectGenre = (genre: string | null) => {
    if (genre === selectedGenre) {
      // Issue 5: clicking the already-selected genre does not trigger a re-fetch; do not set loading
      return;
    }
    setSelectedGenre(genre);
  };

  // Load genres and movies with ignore flag and genre filter (P2-3, P2-4, Issue 5)
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
          setLoadedGenre(selectedGenre);
          setCatalogueError(null);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setCatalogueError(err instanceof Error ? err.message : 'Failed to load movie catalogue');
          setLoadedGenre(selectedGenre);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedGenre, catalogueRetry]);

  // Load schedules using local day bounds (P2-2, P2-3, Issue 6)
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
          setRawSchedules(data.content);
          setLoadedDate(selectedDate);
          setSchedulesError(null);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setRawSchedules([]);
          setLoadedDate(selectedDate);
          setSchedulesError(err instanceof Error ? err.message : 'Failed to load showtimes');
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedDate, schedulesRetry]);

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

  const [featuredDetail, setFeaturedDetail] = useState<MovieDto | null>(null);

  useEffect(() => {
    let ignore = false;
    if (!featuredMovie) return;

    moviesApi
      .getMovie(featuredMovie.id)
      .then((data) => {
        if (!ignore) {
          setFeaturedDetail(data);
        }
      })
      .catch(() => {
        if (!ignore) {
          setFeaturedDetail(null);
        }
      });

    return () => {
      ignore = true;
    };
  }, [featuredMovie]);

  const activeFeaturedDetail =
    featuredDetail && featuredDetail.id === featuredMovie?.id ? featuredDetail : null;

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
          <div
            className="error-banner"
            role="alert"
            style={{
              marginTop: 'var(--space-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{catalogueError}</span>
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => setCatalogueRetry((r) => r + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {schedulesError && (
          <div
            className="error-banner"
            role="alert"
            style={{
              marginTop: 'var(--space-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{schedulesError}</span>
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => setSchedulesRetry((r) => r + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {/* Featured Letter-board Banner */}
        {featuredMovie && (
          <section className="feature" aria-label="Featured Movie">
            <div
              className="art p1"
              style={
                featuredMovie.posterUrl
                  ? {
                      backgroundImage: `url("${featuredMovie.posterUrl}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              {!featuredMovie.posterUrl && <b>{featuredMovie.title}</b>}
            </div>
            <div className="body">
              <div className="board" aria-label="Featured Showtime Details">
                <span>{nextFeaturedShowtime ? 'TONIGHT' : 'NOW PLAYING'}</span>
                {nextFeaturedShowtime && (
                  <>
                    <span>{formatTime(nextFeaturedShowtime.startTime)}</span>
                    <span>{nextFeaturedShowtime.theaterName.toUpperCase()}</span>
                    <span>STD {formatMoney(nextFeaturedShowtime.basePrice)}</span>
                    <span>VIP {formatMoney(nextFeaturedShowtime.vipPrice)}</span>
                  </>
                )}
              </div>
              <h2
                style={{
                  fontFamily: 'var(--display)',
                  fontSize: '32px',
                  margin: 'var(--space-2) 0',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink)',
                }}
              >
                {featuredMovie.title}
              </h2>
              <p className="soft" style={{ fontSize: '15px', lineHeight: 1.6, margin: '0 0 var(--space-3) 0' }}>
                {activeFeaturedDetail?.description || 'A timeless cinematic presentation on the grand retro screen.'}
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: '16px',
                  flexWrap: 'wrap',
                  fontSize: '13px',
                  marginBottom: 'var(--space-4)',
                  color: 'var(--ink)',
                }}
              >
                <span>
                  <strong>Duration:</strong> {formatDuration(featuredMovie.durationMinutes)}
                </span>
                {activeFeaturedDetail?.genres && activeFeaturedDetail.genres.length > 0 && (
                  <span>
                    <strong>Genres:</strong> {activeFeaturedDetail.genres.map((g) => g.name).join(', ')}
                  </span>
                )}
                {nextFeaturedShowtime ? (
                  <>
                    <span>
                      <strong>Hall:</strong> {nextFeaturedShowtime.theaterName}
                    </span>
                    <span>
                      <strong>Admission:</strong> Standard {formatMoney(nextFeaturedShowtime.basePrice)} · VIP {formatMoney(nextFeaturedShowtime.vipPrice)}
                    </span>
                  </>
                ) : (
                  <span>
                    <strong>Showtimes:</strong> Check programme below
                  </span>
                )}
              </div>
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
                isLoading={schedulesLoading}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
