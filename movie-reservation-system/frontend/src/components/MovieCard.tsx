import React from 'react';
import { Link } from 'react-router';
import type { MovieSummary } from '../types/movie';
import type { ScheduleSummary } from '../types/schedule';
import { formatDuration, formatTime } from '../utils/dateUtils';
import { getPosterGradient } from '../utils/posterUtils';

interface MovieCardProps {
  movie: MovieSummary;
  schedules?: ScheduleSummary[];
  genresLabel?: string;
}

export function MovieCard({
  movie,
  schedules = [],
  genresLabel,
}: MovieCardProps): React.JSX.Element {
  const gradient = getPosterGradient(movie.title || movie.id);
  const posterStyle: React.CSSProperties = movie.posterUrl
    ? { backgroundImage: `url(${movie.posterUrl})` }
    : { background: gradient };

  return (
    <article className="movie-card">
      <Link
        to={`/movie/${movie.id}`}
        aria-label={`View showtimes for ${movie.title}`}
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div className="poster" style={posterStyle}>
          {!movie.posterUrl && <div className="ptitle">{movie.title}</div>}
        </div>
        <h3>{movie.title}</h3>
        <div className="meta faint">
          {formatDuration(movie.durationMinutes)}
          {genresLabel ? ` · ${genresLabel}` : ''}
        </div>
      </Link>

      {schedules.length > 0 && (
        <div className="times" aria-label={`Showtimes for ${movie.title}`}>
          {schedules.map((s) => (
            <Link
              key={s.id}
              to={`/book/${s.id}`}
              className="time-pill"
              title={`${s.theaterName} · $${s.basePrice.toFixed(2)}`}
              aria-label={`Book ${formatTime(s.startTime)} in ${s.theaterName}`}
            >
              {formatTime(s.startTime)}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
