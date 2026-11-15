import React, { useEffect, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import * as moviesApi from '../../api/moviesApi';
import * as adminApi from '../../api/adminApi';
import { ApiException } from '../../api/client';
import type { GenreDto } from '../../types/movie';

export function AdminGenresPage(): React.JSX.Element {
  const [genres, setGenres] = useState<GenreDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const reloadData = async () => {
    try {
      const data = await moviesApi.getGenres();
      setGenres(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load genres');
    }
  };

  useEffect(() => {
    let ignore = false;
    moviesApi.getGenres()
      .then((data) => {
        if (!ignore) {
          setGenres(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load genres');
          setIsLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const handleOpenCreate = () => {
    setEditingId(null);
    setName('');
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (genre: GenreDto) => {
    setEditingId(genre.id);
    setName(genre.name);
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        await adminApi.updateGenre(editingId, name.trim());
        setSuccess(`Genre updated to "${name.trim()}".`);
      } else {
        await adminApi.createGenre(name.trim());
        setSuccess(`Genre "${name.trim()}" created successfully.`);
      }
      setIsFormOpen(false);
      setName('');
      await reloadData();
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.status === 409) {
          setError(`A genre named "${name.trim()}" already exists.`);
        } else {
          setError(err.message || 'Failed to save genre.');
        }
      } else {
        setError('Failed to save genre.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number, genreName: string) => {
    if (!window.confirm(`Are you sure you want to delete the genre "${genreName}"?`)) {
      return;
    }

    setDeletingId(id);
    setError(null);
    setSuccess(null);

    try {
      await adminApi.deleteGenre(id);
      setSuccess(`Genre "${genreName}" was deleted.`);
      await reloadData();
    } catch (err) {
      if (err instanceof ApiException && err.status === 409) {
        setError(`Cannot delete "${genreName}": it is currently assigned to one or more movies in the catalogue.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to delete genre.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const filteredGenres = genres.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AdminLayout
      title="Genres Classification"
      subtitle="Organize cinematic categories and styles for cataloguing."
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-4)',
        }}
      >
        <input
          type="search"
          placeholder="Filter genres by name…"
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
          aria-label="Filter genres by name"
        />

        <button
          type="button"
          className="btn red"
          onClick={handleOpenCreate}
          aria-label="Create new genre"
        >
          + Add New Genre
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

      {/* Create / Edit Form Card */}
      {isFormOpen && (
        <section
          aria-label={editingId ? 'Edit Genre Form' : 'Create Genre Form'}
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
            {editingId ? 'Modify Genre' : 'New Classification'}
          </div>
          <h2 style={{ margin: '0 0 var(--space-4) 0', fontSize: '20px' }}>
            {editingId ? 'Edit Genre Name' : 'Create New Genre'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '480px' }}>
            <div>
              <label htmlFor="genre-name-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Genre Name *
              </label>
              <input
                id="genre-name-input"
                type="text"
                required
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Science Fiction, Film Noir"
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

            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="submit"
                className="btn red"
                disabled={isSaving || !name.trim()}
              >
                {isSaving ? 'Saving…' : editingId ? 'Update Genre' : 'Create Genre'}
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

      {/* Genres Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          <p className="soft">Loading genres classification…</p>
        </div>
      ) : filteredGenres.length === 0 ? (
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
            {search ? 'No genres match your search query.' : 'No genres found in catalogue.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ID</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Genre Name</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGenres.map((genre) => (
                <tr
                  key={genre.id}
                  style={{
                    borderBottom: '1px solid var(--sand)',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--teal)', fontFamily: 'monospace' }}>
                    #{genre.id}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: '15px' }}>
                    <span className="badge" style={{ background: 'var(--sand-light, #fbf7ee)', border: '1px solid var(--ink)', padding: '3px 8px' }}>
                      {genre.name}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleOpenEdit(genre)}
                        style={{ padding: '4px 10px', fontSize: '13px' }}
                        aria-label={`Edit ${genre.name}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleDelete(genre.id, genre.name)}
                        disabled={deletingId === genre.id}
                        style={{
                          padding: '4px 10px',
                          fontSize: '13px',
                          color: 'var(--red)',
                          borderColor: 'var(--red)',
                        }}
                        aria-label={`Delete ${genre.name}`}
                      >
                        {deletingId === genre.id ? 'Deleting…' : 'Delete'}
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
