import React, { useEffect, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import * as moviesApi from '../../api/moviesApi';
import * as adminApi from '../../api/adminApi';
import { ApiException } from '../../api/client';
import type { GenreDto, MovieSummary } from '../../types/movie';

export function AdminMoviesPage(): React.JSX.Element {
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [genres, setGenres] = useState<GenreDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(120);
  const [releaseDate, setReleaseDate] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [selectedGenreIds, setSelectedGenreIds] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const reloadData = async () => {
    try {
      const [moviesRes, genresRes] = await Promise.all([
        moviesApi.getMovies({ size: 100 }),
        moviesApi.getGenres(),
      ]);
      setMovies(moviesRes.content);
      setGenres(genresRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load movie catalogue');
    }
  };

  useEffect(() => {
    let ignore = false;
    Promise.all([
      moviesApi.getMovies({ size: 100 }),
      moviesApi.getGenres(),
    ])
      .then(([moviesRes, genresRes]) => {
        if (!ignore) {
          setMovies(moviesRes.content);
          setGenres(genresRes);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load movie catalogue');
          setIsLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const handleOpenCreate = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setDurationMinutes(120);
    setReleaseDate(new Date().toISOString().slice(0, 10));
    setPosterUrl('');
    setSelectedGenreIds([]);
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = async (movie: MovieSummary) => {
    setEditingId(movie.id);
    setTitle(movie.title);
    setDurationMinutes(movie.durationMinutes);
    setReleaseDate(movie.releaseDate || '');
    setPosterUrl(movie.posterUrl || '');
    setSelectedGenreIds([]);
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);

    try {
      const full = await moviesApi.getMovie(movie.id);
      setDescription(full.description || '');
      setSelectedGenreIds(full.genres.map((g) => g.id));
    } catch {
      // Ignored
    }
  };

  const handleToggleGenre = (genreId: number) => {
    setSelectedGenreIds((prev) =>
      prev.includes(genreId) ? prev.filter((id) => id !== genreId) : [...prev, genreId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      posterUrl: posterUrl.trim() || null,
      durationMinutes: Number(durationMinutes),
      releaseDate: releaseDate || null,
      genreIds: selectedGenreIds,
    };

    try {
      if (editingId) {
        await adminApi.updateMovie(editingId, payload);
        setSuccess(`Updated film "${payload.title}" successfully.`);
      } else {
        await adminApi.createMovie(payload);
        setSuccess(`Added film "${payload.title}" to catalogue.`);
      }
      setIsFormOpen(false);
      await reloadData();
    } catch (err) {
      if (err instanceof ApiException) {
        setError(err.message || 'Validation error saving movie.');
      } else {
        setError('Failed to save movie.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number, movieTitle: string) => {
    if (!window.confirm(`Are you sure you want to delete "${movieTitle}"? This action cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    setError(null);
    setSuccess(null);
    try {
      await adminApi.deleteMovie(id);
      setSuccess(`Film "${movieTitle}" was deleted.`);
      await reloadData();
    } catch (err) {
      if (err instanceof ApiException && err.status === 409) {
        setError(`Cannot delete "${movieTitle}": active showtimes or booking tickets exist for this film.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to delete movie.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const filteredMovies = movies.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AdminLayout
      title="Films & Feature Catalogue"
      subtitle="Manage movie titles, descriptions, artwork posters, running times, and genre classifications."
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <input
          type="search"
          placeholder="Filter films by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '2px solid var(--ink)',
            borderRadius: '4px',
            background: '#fff',
            fontFamily: 'inherit',
            fontSize: '14px',
            minWidth: '260px',
          }}
          aria-label="Filter movies by title"
        />

        <button
          type="button"
          className="btn red"
          onClick={handleOpenCreate}
          aria-label="Add new movie to catalogue"
        >
          + Add New Film
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          style={{
            marginBottom: 'var(--space-4)',
            padding: '10px 16px',
            background: 'var(--sand-light, #fbf7ee)',
            border: '2px solid var(--teal)',
            color: 'var(--teal)',
            fontWeight: 'bold',
            borderRadius: '4px',
          }}
        >
          ✓ {success}
        </div>
      )}

      {/* Create / Edit Form Modal Card */}
      {isFormOpen && (
        <section
          aria-label={editingId ? 'Edit Film Form' : 'New Film Form'}
          className="ticket"
          style={{
            background: '#fff',
            border: '3px solid var(--ink)',
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="kicker" style={{ color: 'var(--red)', marginBottom: '4px' }}>
            {editingId ? 'Modify Feature' : 'New Box Office Entry'}
          </div>
          <h2 style={{ margin: '0 0 var(--space-4) 0', fontSize: '20px' }}>
            {editingId ? 'Edit Film Details' : 'Add Film to Catalogue'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="movie-title-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Film Title *
              </label>
              <input
                id="movie-title-input"
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Casablanca"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  background: 'var(--sand-light, #fbf7ee)',
                }}
              />
            </div>

            <div>
              <label htmlFor="movie-duration-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Running Time (minutes) *
              </label>
              <input
                id="movie-duration-input"
                type="number"
                min={1}
                max={600}
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  background: 'var(--sand-light, #fbf7ee)',
                }}
              />
            </div>

            <div>
              <label htmlFor="movie-release-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Release Date (optional)
              </label>
              <input
                id="movie-release-input"
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  background: 'var(--sand-light, #fbf7ee)',
                }}
              />
            </div>

            <div>
              <label htmlFor="movie-poster-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Poster Artwork URL or /posters/ path
              </label>
              <input
                id="movie-poster-input"
                type="text"
                value={posterUrl}
                onChange={(e) => setPosterUrl(e.target.value)}
                placeholder="https://... or /posters/film.jpg"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  background: 'var(--sand-light, #fbf7ee)',
                }}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="movie-description-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Synopsis / Description (optional)
              </label>
              <textarea
                id="movie-description-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief synopsis of the film..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  background: 'var(--sand-light, #fbf7ee)',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px' }}>
                Genre Classifications
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {genres.map((g) => {
                  const isChecked = selectedGenreIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => handleToggleGenre(g.id)}
                      style={{
                        padding: '6px 12px',
                        border: '2px solid var(--ink)',
                        borderRadius: '4px',
                        background: isChecked ? 'var(--mustard)' : '#fff',
                        fontWeight: isChecked ? 'bold' : 'normal',
                        cursor: 'pointer',
                        fontSize: '13px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{isChecked ? '✓' : '+'}</span>
                      <span>{g.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Poster Preview */}
            {posterUrl && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--sand-light, #fbf7ee)', padding: '12px', borderRadius: '4px', border: '1px solid var(--sand)' }}>
                <img
                  src={posterUrl}
                  alt="Poster preview"
                  style={{ width: '60px', height: '88px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--ink)' }}
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div style={{ fontSize: '13px' }}>
                  <strong>Poster Artwork Live Preview</strong>
                  <div className="soft">{posterUrl}</div>
                </div>
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="submit"
                className="btn red"
                disabled={isSaving || !title.trim()}
              >
                {isSaving ? 'Saving…' : editingId ? 'Update Film' : 'Add to Catalogue'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setIsFormOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Movies Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          <p className="soft">Loading movie catalogue…</p>
        </div>
      ) : filteredMovies.length === 0 ? (
        <div
          className="ticket"
          style={{
            background: '#fff',
            border: '2px dashed var(--sand)',
            padding: 'var(--space-8)',
            textAlign: 'center',
          }}
        >
          <p className="soft" style={{ fontSize: '16px', margin: 0 }}>
            {search ? 'No films match your search query.' : 'No films in catalogue yet.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ID</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Poster</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Film Title</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Release</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMovies.map((m) => (
                <tr
                  key={m.id}
                  style={{
                    borderBottom: '1px solid var(--sand)',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--teal)', fontFamily: 'monospace' }}>
                    #{m.id}
                  </td>
                  <td style={{ padding: '8px 16px' }}>
                    {m.posterUrl ? (
                      <img
                        src={m.posterUrl}
                        alt={m.title}
                        style={{ width: '34px', height: '48px', objectFit: 'cover', borderRadius: '3px', border: '1px solid var(--ink)' }}
                      />
                    ) : (
                      <div style={{ width: '34px', height: '48px', background: 'var(--sand)', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--ink)' }}>
                        🎞️
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', fontSize: '15px' }}>
                    {m.title}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '14px' }}>
                    {m.durationMinutes} min
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--ink-soft)' }}>
                    {m.releaseDate || '—'}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleOpenEdit(m)}
                        style={{ padding: '4px 10px', fontSize: '13px' }}
                        aria-label={`Edit ${m.title}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost danger"
                        onClick={() => handleDelete(m.id, m.title)}
                        disabled={deletingId === m.id}
                        aria-label={`Delete ${m.title}`}
                      >
                        {deletingId === m.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
