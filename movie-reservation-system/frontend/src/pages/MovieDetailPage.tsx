import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { DateSelector } from '../components/DateSelector';
import type { MovieDto } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import * as moviesApi from '../api/moviesApi';
import * as schedulesApi from '../api/schedulesApi';
import { formatDuration, formatTime, getUpcomingDays } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

export function MovieDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const navigate = useNavigate();

  const days = useMemo(() => getUpcomingDays(7), []);
  const [selectedDate, setSelectedDate] = useState<string>(days[0]?.dateString ?? '');

  const [movie, setMovie] = useState<MovieDto | null>(null);
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMovie() {
      if (!movieId) return;
      try {
        setLoading(true);
        const data = await moviesApi.getMovie(movieId);
        setMovie(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load movie details');
      } finally {
        setLoading(false);
      }
    }
    void loadMovie();
  }, [movieId]);

  useEffect(() => {
    async function loadSchedules() {
      if (!movieId || !selectedDate) return;
      try {
        const data = await schedulesApi.getSchedules({
          movieId,
          date: selectedDate,
          size: 50,
        });
        setSchedules(data.content);
        if (data.content.length > 0) {
          setSelectedScheduleId(data.content[0].id);
        } else {
          setSelectedScheduleId(null);
        }
      } catch {
        setSchedules([]);
      }
    }
    void loadSchedules();
  }, [movieId, selectedDate]);

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

  if (loading) {
    return (
      <div className="screen-container">
        <TopBar />
        <main className="wrap">
          <div className="skeleton" style={{ height: '400px', borderRadius: 'var(--radius-xl)' }} />
        </main>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="screen-container">
        <TopBar />
        <main className="wrap">
          <div className="error-banner">{error || 'Movie not found'}</div>
          <Link to="/" className="btn btn-ghost" style={{ marginTop: 'var(--space-4)' }}>
            ← Back to movies
          </Link>
        </main>
      </div>
    );
  }

  const gradient = getPosterGradient(movie.title || movie.id);

  return (
    <div className="screen-container">
      <TopBar />

      <main className="wrap">
        <div className="faint" style={{ fontSize: '14px', marginBottom: 'var(--space-6)' }}>
          <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>Now showing</Link>
          {' '}›{' '}
          <span className="muted">{movie.title}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 'var(--space-8)' }}>
          {/* Movie Poster */}
          <div>
            <div
              className="poster"
              style={{
                height: '440px',
                width: '100%',
                background: movie.posterUrl ? `url(${movie.posterUrl})` : gradient,
              }}
            >
              {!movie.posterUrl && (
                <div className="ptitle" style={{ fontSize: '28px' }}>
                  {movie.title}
                </div>
              )}
            </div>
          </div>

          {/* Details & Showtimes */}
          <div>
            <h1>{movie.title}</h1>

            <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-3) 0 var(--space-4)', flexWrap: 'wrap' }}>
              <span className="chip">{formatDuration(movie.durationMinutes)}</span>
              {movie.genres.map((g) => (
                <span key={g.id} className="chip">{g.name}</span>
              ))}
              <span className="chip">Released {movie.releaseDate}</span>
            </div>

            <p className="muted" style={{ maxWidth: '760px', lineHeight: 1.6, fontSize: '15px' }}>
              {movie.description}
            </p>

            <h2 style={{ marginTop: 'var(--space-6)' }}>Select date</h2>
            <DateSelector
              days={days}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />

            <h2 style={{ marginTop: 'var(--space-6)' }}>Showtimes</h2>

            {schedules.length === 0 ? (
              <div style={{ padding: 'var(--space-6) 0', color: 'var(--ink-soft)' }}>
                No showtimes scheduled for this date. Please choose another day above.
              </div>
            ) : (
              Array.from(schedulesByTheater.entries()).map(([theaterName, thSchedules]) => {
                const sample = thSchedules[0];
                return (
                  <div
                    key={theaterName}
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-lg)',
                      padding: 'var(--space-6)',
                      marginTop: 'var(--space-4)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <h2>{theaterName}</h2>
                      <span className="muted" style={{ fontSize: '14px' }}>
                        Standard <b style={{ color: 'var(--ink)' }}>${sample.basePrice.toFixed(2)}</b> · VIP{' '}
                        <b style={{ color: 'var(--amber)' }}>${sample.vipPrice.toFixed(2)}</b>
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
                      {thSchedules.map((s) => {
                        const isSelected = s.id === selectedScheduleId;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`btn ${isSelected ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setSelectedScheduleId(s.id)}
                            aria-pressed={isSelected}
                            style={{ height: '44px', minHeight: '44px' }}
                          >
                            <b>{formatTime(s.startTime)}</b>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}

            {selectedSchedule && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate(`/book/${selectedSchedule.id}`)}
                >
                  Choose seats for {formatTime(selectedSchedule.startTime)} ({selectedSchedule.theaterName}) →
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
