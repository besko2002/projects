import React, { useEffect, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import * as adminApi from '../../api/adminApi';
import { ApiException } from '../../api/client';
import type { TheaterDto, TheaterSummary } from '../../types/admin';

export function AdminHallsPage(): React.JSX.Element {
  const [halls, setHalls] = useState<TheaterSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [totalRows, setTotalRows] = useState<number>(8);
  const [seatsPerRow, setSeatsPerRow] = useState<number>(10);
  const [vipRowsInput, setVipRowsInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const reloadData = async () => {
    try {
      const pageRes = await adminApi.getTheaters(0, 100);
      setHalls(pageRes.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cinema halls');
    }
  };

  useEffect(() => {
    let ignore = false;
    adminApi.getTheaters(0, 100)
      .then((pageRes) => {
        if (!ignore) {
          setHalls(pageRes.content);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load cinema halls');
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
    setLocation('');
    setTotalRows(8);
    setSeatsPerRow(10);
    setVipRowsInput('');
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = async (hall: TheaterSummary) => {
    setEditingId(hall.id);
    setName(hall.name);
    setLocation(hall.location || '');
    setTotalRows(hall.totalRows);
    setSeatsPerRow(hall.seatsPerRow);
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);

    try {
      const full: TheaterDto = await adminApi.getTheater(hall.id);
      setVipRowsInput((full.vipRows || []).join(', '));
    } catch {
      setVipRowsInput('');
    }
  };

  const parseVipRows = (input: string): string[] => {
    return input
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length === 1 && s >= 'A' && s <= 'Z');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const vipRows = parseVipRows(vipRowsInput);

    // Validate that VIP rows are within range of totalRows
    const maxRowChar = String.fromCharCode('A'.charCodeAt(0) + totalRows - 1);
    const outOfBounds = vipRows.filter((r) => r > maxRowChar);
    if (outOfBounds.length > 0) {
      setError(`VIP rows [${outOfBounds.join(', ')}] exceed hall capacity (Rows A to ${maxRowChar}).`);
      setIsSaving(false);
      return;
    }

    const payload = {
      name: name.trim(),
      location: location.trim() || null,
      totalRows: Number(totalRows),
      seatsPerRow: Number(seatsPerRow),
      vipRows,
    };

    try {
      if (editingId) {
        await adminApi.updateTheater(editingId, payload);
        setSuccess(`Hall "${payload.name}" updated successfully.`);
      } else {
        await adminApi.createTheater(payload);
        setSuccess(`Hall "${payload.name}" created with ${payload.totalRows * payload.seatsPerRow} seats.`);
      }
      setIsFormOpen(false);
      await reloadData();
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.status === 409) {
          setError(
            editingId
              ? 'Cannot regenerate seat layout: active showtimes or bookings exist for this hall.'
              : `A hall named "${payload.name}" already exists.`,
          );
        } else {
          setError(err.message || 'Validation error saving hall.');
        }
      } else {
        setError('Failed to save cinema hall.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number, hallName: string) => {
    if (!window.confirm(`Are you sure you want to delete hall "${hallName}"? All associated seats will be removed.`)) {
      return;
    }

    setDeletingId(id);
    setError(null);
    setSuccess(null);

    try {
      await adminApi.deleteTheater(id);
      setSuccess(`Hall "${hallName}" was deleted.`);
      await reloadData();
    } catch (err) {
      if (err instanceof ApiException && err.status === 409) {
        setError(`Cannot delete "${hallName}": active showtimes are scheduled in this hall.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to delete hall.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const filteredHalls = halls.filter((h) =>
    h.name.toLowerCase().includes(search.toLowerCase()) ||
    (h.location && h.location.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <AdminLayout
      title="Cinema Auditoriums & Halls"
      subtitle="Configure physical auditoriums, seating dimensions, and VIP section boundaries."
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
          placeholder="Filter auditoriums by name or location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '2px solid var(--ink)',
            borderRadius: '4px',
            background: '#fff',
            fontFamily: 'inherit',
            fontSize: '14px',
            minWidth: '280px',
          }}
          aria-label="Filter halls by name or location"
        />

        <button
          type="button"
          className="btn red"
          onClick={handleOpenCreate}
          aria-label="Create new auditorium"
        >
          + Add New Hall
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
          aria-label={editingId ? 'Edit Auditorium' : 'Create Auditorium'}
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
            {editingId ? 'Modify Auditorium' : 'New Hall Configuration'}
          </div>
          <h2 style={{ margin: '0 0 var(--space-4) 0', fontSize: '20px' }}>
            {editingId ? 'Edit Hall Details & Grid' : 'Create Cinema Auditorium'}
          </h2>

          {editingId && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                background: '#fff5e6',
                border: '2px solid var(--mustard)',
                color: 'var(--ink)',
                fontSize: '13px',
                borderRadius: '4px',
                lineHeight: 1.5,
              }}
            >
              ⚠️ <strong>Warning:</strong> Changing the seating grid (rows, seats per row, or VIP rows) regenerates all physical seat mappings. If any showtimes are scheduled for this hall, the server will reject the change with a 409 Conflict error.
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            <div>
              <label htmlFor="hall-name-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Auditorium Name *
              </label>
              <input
                id="hall-name-input"
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Grand Auditorium, Screen 2"
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
              <label htmlFor="hall-location-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Location / Floor (optional)
              </label>
              <input
                id="hall-location-input"
                type="text"
                maxLength={200}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. 1st Floor East Wing"
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
              <label htmlFor="hall-rows-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Number of Rows (1 – 26) *
              </label>
              <input
                id="hall-rows-input"
                type="number"
                min={1}
                max={26}
                required
                value={totalRows}
                onChange={(e) => setTotalRows(Math.max(1, Math.min(26, Number(e.target.value))))}
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
              <span className="soft" style={{ fontSize: '12px' }}>
                Rows are labelled A through {String.fromCharCode('A'.charCodeAt(0) + totalRows - 1)}.
              </span>
            </div>

            <div>
              <label htmlFor="hall-seats-per-row-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                Seats per Row (1 – 50) *
              </label>
              <input
                id="hall-seats-per-row-input"
                type="number"
                min={1}
                max={50}
                required
                value={seatsPerRow}
                onChange={(e) => setSeatsPerRow(Math.max(1, Math.min(50, Number(e.target.value))))}
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
              <span className="soft" style={{ fontSize: '12px' }}>
                Total capacity: <strong>{totalRows * seatsPerRow} seats</strong>
              </span>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="hall-vip-rows-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                VIP Rows (comma-separated, optional)
              </label>
              <input
                id="hall-vip-rows-input"
                type="text"
                value={vipRowsInput}
                onChange={(e) => setVipRowsInput(e.target.value)}
                placeholder="e.g. G, H"
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
              <span className="soft" style={{ fontSize: '12px' }}>
                Enter single letter row identifiers (e.g. &quot;G, H&quot;). VIP seats are billed at the showtime&apos;s VIP rate.
              </span>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="submit"
                className="btn red"
                disabled={isSaving || !name.trim()}
              >
                {isSaving ? 'Saving…' : editingId ? 'Update Hall' : 'Create Hall'}
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

      {/* Halls Grid Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          <p className="soft">Loading cinema halls…</p>
        </div>
      ) : filteredHalls.length === 0 ? (
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
            {search ? 'No auditoriums match your search.' : 'No cinema halls registered yet.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Auditorium</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grid (Rows × Seats)</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Capacity</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredHalls.map((hall) => (
                <tr
                  key={hall.id}
                  style={{
                    borderBottom: '1px solid var(--sand)',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', fontSize: '15px' }}>
                    {hall.name}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-light)', fontSize: '14px' }}>
                    {hall.location || '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '14px' }}>
                    {hall.totalRows} rows × {hall.seatsPerRow} seats
                    <span className="soft" style={{ fontSize: '12px', display: 'block' }}>
                      (Rows A–{String.fromCharCode('A'.charCodeAt(0) + hall.totalRows - 1)})
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className="badge" style={{ background: 'var(--teal)', color: '#fff', padding: '3px 8px' }}>
                      {hall.totalSeats} seats
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleOpenEdit(hall)}
                        style={{ padding: '4px 10px', fontSize: '13px' }}
                        aria-label={`Edit ${hall.name}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => handleDelete(hall.id, hall.name)}
                        disabled={deletingId === hall.id}
                        style={{
                          padding: '4px 10px',
                          fontSize: '13px',
                          color: 'var(--red)',
                          borderColor: 'var(--red)',
                        }}
                        aria-label={`Delete ${hall.name}`}
                      >
                        {deletingId === hall.id ? 'Deleting…' : 'Delete'}
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
