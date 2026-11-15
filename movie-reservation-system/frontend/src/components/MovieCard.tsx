import React from 'react';
import { Link } from 'react-router';
import type { MovieSummary } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import { formatDuration, formatTime } from '../utils/dateUtils';
import { formatMoney } from '../utils/moneyUtils';

interface MovieCardProps {
  movie: MovieSummary;
  schedules?: ScheduleSummary[];
  genresLabel?: string;
  isLoading?: boolean;
}

export function MovieCard({
  movie,
  schedules = [],
  genresLabel,
  isLoading = false,
}: MovieCardProps): React.JSX.Element {
  const [referenceTime] = React.useState<number>(() => Date.now());
  const colorIndex = (movie.id % 4) + 1; // 1..4 -> p1..p4
  const primaryGenre = genresLabel?.split(',')[0] || 'FEATURE';

  // Compute minimum base price from showtimes if available
  const activeSchedules = schedules.filter(
    (s) => new Date(s.startTime).getTime() > referenceTime,
  );
  const minPrice =
    activeSchedules.length > 0
      ? Math.min(...activeSchedules.map((s) => s.basePrice))
      : null;

  const encodedPosterUrl = movie.posterUrl
    ? encodeURI(movie.posterUrl).replace(/"/g, '\\"')
    : null;

  return (
    <article className="ticket movie-card" aria-label={movie.title}>
      <Link
        to={`/movie/${movie.id}`}
        aria-label={`View showtimes for ${movie.title}`}
        className="ticket-link"
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        <div
          className={`poster p${colorIndex}`}
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
          <span className="stamp">{primaryGenre}</span>
          <b>{movie.title}</b>
        </div>
      </Link>

      <div className="perf" aria-hidden="true" />

      <div className="stub">
        <div className="meta">
          <span>{formatDuration(movie.durationMinutes)}</span>
          {minPrice !== null ? (
            <span>From {formatMoney(minPrice)}</span>
          ) : (
            <span>{primaryGenre}</span>
          )}
        </div>

        {isLoading ? (
          <div className="times-empty">
            <span className="faint" style={{ fontSize: '13px' }}>
              Loading showtimes...
            </span>
          </div>
        ) : activeSchedules.length > 0 ? (
          <div className="times" aria-label={`Showtimes for ${movie.title}`}>
            {activeSchedules.slice(0, 4).map((s) => (
              <Link
                key={s.id}
                to={`/book/${s.id}`}
                className="t time-pill"
                title={`${s.theaterName} · ${formatMoney(s.basePrice)}`}
                aria-label={`Book ${formatTime(s.startTime)} in ${s.theaterName}`}
              >
                {formatTime(s.startTime)}
              </Link>
            ))}
          </div>
        ) : (
          <div className="times-empty">
            <span className="faint" style={{ fontSize: '13px' }}>
              No remaining showtimes today
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
