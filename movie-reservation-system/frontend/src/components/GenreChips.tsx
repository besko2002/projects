import React from 'react';
import type { GenreDto } from '../types/movie';

interface GenreChipsProps {
  genres: GenreDto[];
  selectedGenre: string | null;
  onSelectGenre: (genreName: string | null) => void;
}

export function GenreChips({
  genres,
  selectedGenre,
  onSelectGenre,
}: GenreChipsProps): React.JSX.Element {
  return (
    <div
      style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}
      role="group"
      aria-label="Filter movies by genre"
    >
      <button
        type="button"
        className={`chip ${selectedGenre === null ? 'on' : ''}`}
        onClick={() => onSelectGenre(null)}
        aria-pressed={selectedGenre === null}
      >
        All
      </button>
      {genres.map((g) => {
        const isSelected = selectedGenre === g.name;
        return (
          <button
            key={g.id}
            type="button"
            className={`chip ${isSelected ? 'on' : ''}`}
            onClick={() => onSelectGenre(g.name)}
            aria-pressed={isSelected}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}
