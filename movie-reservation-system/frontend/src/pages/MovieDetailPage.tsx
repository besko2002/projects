import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { DateSelector } from '../components/DateSelector';
import type { MovieDto } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';
import { formatDuration, formatTime, getUpcomingDays } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

export function MovieDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const isInvalidId = !Number.isInteger(movieId) || movieId <= 0;

  const navigate = useNavigate();

  const days = useMemo(() => getUpcomingDays(7), []);
  const [selectedDate, setSelectedDate] = useState<string>(days[0]?.dateString ?? '');

  const [movie, setMovie] = useState<MovieDto | null>(null);
  const [rawSchedules, setRawSchedules] = useState<ScheduleSummary[]>([]);
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(!isInvalidId);
  const [movieError, setMovieError] = useState<string | null>(
    isInvalidId ? 'Invalid movie reference.' : null,
  );
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [schedulesRetry, setSchedulesRetry] = useState<number>(0);
  const [referenceTime] = useState<number>(() => Date.now());

  // Derived showtimes and loading state without synchronous setState in effects
  const schedulesLoading = loadedDate !== selectedDate && !schedulesError;
  const schedules = useMemo(() => {
    return loadedDate === selectedDate ? rawSchedules : [];
  }, [loadedDate, selectedDate, rawSchedules]);

  // Load movie details with ignore flag (P2-3)
  useEffect(() => {
    let ignore = false;
    if (isInvalidId) return;

    moviesApi
      .getMovie(movieId)
      .then((data) => {
        if (!ignore) {
          setMovie(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setMovieError(err instanceof Error ? err.message : 'Movie not found');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [movieId, isInvalidId]);

  // Load schedules using user's local day bounds with ignore flag (P2-2, P2-3, Issue 6)
  useEffect(() => {
    let ignore = false;
    if (isInvalidId || !selectedDate) return;

    const [y, m, d] = selectedDate.split('-').map(Number);
    const localStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const localEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    schedulesApi
      .getSchedules({
        movieId,
        from: localStart.toISOString(),
        to: localEnd.toISOString(),
        size: 50,
      })
      .then((data) => {
        if (!ignore) {
          setRawSchedules(data.content);
          setLoadedDate(selectedDate);
          setSchedulesError(null);

          // Select only a future, bookable showtime (Issue 6)
          const now = Date.now();
          const futureSchedules = data.content.filter(
            (s) => new Date(s.startTime).getTime() > now,
          );
          if (futureSchedules.length > 0) {
            setSelectedScheduleId(futureSchedules[0].id);
          } else {
            setSelectedScheduleId(null);
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          setRawSchedules([]);
          setLoadedDate(selectedDate);
          setSelectedScheduleId(null);
          setSchedulesError(err instanceof Error ? err.message : 'Failed to load showtimes');
        }
      });

    return () => {
      ignore = true;
    };
  }, [movieId, selectedDate, isInvalidId, schedulesRetry]);

  // Group schedules by theater
  const schedulesByTheater = useMemo(() => {
    const map = new Map<string, ScheduleSummary[]>();
    for (const s of schedules) {
      const list = map.get(s.theaterName) || [];
      list.push(s);
      map.set(s.theaterName, list);
    }
    return map;
  }, [schedules]);

  const selectedSchedule = useMemo(() => {
    return schedules.find((s) => s.id === selectedScheduleId) || null;
  }, [schedules, selectedScheduleId]);

  if (isInvalidId || movieError || (!loading && !movie)) {
    return (
      <div className="screen screen-container">
        <TopBar />
        <main className="wrap">
          <div className="error-banner" role="alert">
            {movieError || 'Movie not found'}
          </div>
          <div style={{ marginTop: 'var(--space-6)' }}>
            <Link to="/" className="btn">
              ← Back to movies
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (loading || !movie) {
    return (
      <div className="screen screen-container">
        <TopBar />
        <main className="wrap">
          <div className="skeleton" style={{ height: '420px', border: '3px solid var(--ink)' }} />
        </main>
      </div>
    );
  }

  const encodedPosterUrl = movie.posterUrl
    ? encodeURI(movie.posterUrl).replace(/"/g, '\\"')
    : null;

  return (
    <div className="screen screen-container">
      <TopBar />

      <main className="wrap">
        <div className="kicker">
          <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            Now showing
          </Link>{' '}
          › <span style={{ color: 'var(--ink)' }}>{movie.title}</span>
        </div>

        <h1 style={{ marginTop: 'var(--space-2)' }}>{movie.title}</h1>

        <div className="movie-detail-layout" style={{ marginTop: 'var(--space-6)' }}>
          {/* Movie Poster & Metadata */}
          <div className="ticket" style={{ alignSelf: 'start' }}>
            <div
              className="poster p1"
              style={
                encodedPosterUrl
                  ? {
                      backgroundImage: `url("${encodedPosterUrl}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              <span className="stamp">{movie.genres?.[0]?.name || 'FEATURE'}</span>
              <b>{movie.title}</b>
            </div>
            <div className="perf" aria-hidden="true" />
            <div className="stub">
              <div className="meta">
                <span>{formatDuration(movie.durationMinutes)}</span>
                <span>{movie.genres.map((g) => g.name).join(', ')}</span>
              </div>
              <p className="soft" style={{ marginTop: 'var(--space-3)', fontSize: '14px', lineHeight: 1.55 }}>
                {movie.description}
              </p>
            </div>
          </div>

          {/* Showtimes & Hall Selection */}
          <div className="showtimes-section">
            <h2>Select showtime date</h2>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <DateSelector
                days={days}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            </div>

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

            <div style={{ marginTop: 'var(--space-6)' }}>
              <h2>Available halls &amp; showtimes</h2>

              {schedulesLoading ? (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div className="skeleton" style={{ height: '100px', border: '3px solid var(--ink)' }} />
                </div>
              ) : schedules.length === 0 && !schedulesError ? (
                <div
                  style={{
                    padding: 'var(--space-8)',
                    border: '3px solid var(--ink)',
                    background: 'var(--paper)',
                    boxShadow: 'var(--shadow)',
                    marginTop: 'var(--space-3)',
                    textAlign: 'center',
                  }}
                >
                  <p className="soft">No showtimes scheduled for this date.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                  {Array.from(schedulesByTheater.entries()).map(([theaterName, list]) => (
                    <div
                      key={theaterName}
                      style={{
                        background: 'var(--paper)',
                        border: '3px solid var(--ink)',
                        boxShadow: 'var(--shadow)',
                        padding: 'var(--space-4) var(--space-6)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontFamily: 'var(--display)', fontSize: '24px', letterSpacing: '0.04em' }}>
                          {theaterName.toUpperCase()}
                        </h3>
                        <span className="soft" style={{ fontSize: '13px', fontWeight: 700 }}>
                          Standard {formatMoney(list[0]?.basePrice)} · VIP {formatMoney(list[0]?.vipPrice)}
                        </span>
                      </div>

                      <div className="times" style={{ marginTop: 'var(--space-3)' }}>
                        {list.map((s) => {
                          const isSelected = s.id === selectedScheduleId;
                          const isPast = new Date(s.startTime).getTime() <= referenceTime;

                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={isPast}
                              className={`t ${isSelected ? 'selected' : ''}`}
                              onClick={() => setSelectedScheduleId(s.id)}
                              aria-pressed={isSelected}
                              aria-label={`${formatTime(s.startTime)} in ${theaterName}${isPast ? ' (Passed)' : ''}`}
                            >
                              {formatTime(s.startTime)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Bar: only enabled for future, bookable showtimes (Issue 6) */}
            {selectedSchedule && new Date(selectedSchedule.startTime).getTime() > referenceTime && (
              <div
                style={{
                  marginTop: 'var(--space-8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--paper)',
                  border: '3px solid var(--ink)',
                  boxShadow: 'var(--shadow)',
                  padding: 'var(--space-4) var(--space-6)',
                }}
              >
                <div>
                  <div className="kicker">Selected showtime</div>
                  <b style={{ fontSize: '18px' }}>
                    {formatTime(selectedSchedule.startTime)} · {selectedSchedule.theaterName}
                  </b>
                </div>

                <button
                  type="button"
                  className="btn red"
                  onClick={() => navigate(`/book/${selectedSchedule.id}`)}
                  aria-label={`Choose seats for ${formatTime(selectedSchedule.startTime)}`}
                >
                  Choose seats for {formatTime(selectedSchedule.startTime)}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
