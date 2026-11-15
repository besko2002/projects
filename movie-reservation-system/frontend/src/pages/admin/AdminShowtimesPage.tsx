import React, { useEffect, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import * as moviesApi from '../../api/moviesApi';
import * as schedulesApi from '../../api/schedulesApi';
import * as adminApi from '../../api/adminApi';
import { ApiException } from '../../api/client';
import { getDaysBetween, isValidTimeZone, todayInZone, zonedWallTimeToDate } from '../../utils/dateUtils';
import type { MovieSummary } from '../../types/movie';
import type { ScheduleSummary } from '../../types/schedule';
import type { TheaterSummary } from '../../types/admin';

export interface BulkSlotResult {
  slot: string;
  status: 'created' | 'conflict' | 'past' | 'error';
  reason: string;
}

function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function AdminShowtimesPage(): React.JSX.Element {
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [theaters, setTheaters] = useState<TheaterSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [filterTheaterId, setFilterTheaterId] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Showtimes are planned in the cinema's own zone (app.schedule.zone), not the admin's browser zone.
  const [cinemaZone, setCinemaZone] = useState<string | null>(null);

  // Mode: list / single / bulk
  const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('single');
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Single form state
  const [selectedMovieId, setSelectedMovieId] = useState<number | ''>('');
  const [selectedTheaterId, setSelectedTheaterId] = useState<number | ''>('');
  const [startDateTime, setStartDateTime] = useState<string>('');
  const [basePrice, setBasePrice] = useState<number>(12.5);
  const [vipPrice, setVipPrice] = useState<number>(18.0);
  const [isSaving, setIsSaving] = useState(false);

  // Bulk scheduler state
  const [bulkMovieId, setBulkMovieId] = useState<number | ''>('');
  const [bulkTheaterId, setBulkTheaterId] = useState<number | ''>('');
  const [bulkStartDate, setBulkStartDate] = useState<string>('');
  const [bulkEndDate, setBulkEndDate] = useState<string>('');
  const [bulkTimesInput, setBulkTimesInput] = useState<string>('14:00, 17:30, 20:30');
  const [bulkBasePrice, setBulkBasePrice] = useState<number>(12.5);
  const [bulkVipPrice, setBulkVipPrice] = useState<number>(18.0);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkSlotResult[] | null>(null);

  const reloadSchedules = async () => {
    try {
      const params: schedulesApi.ScheduleQueryParams = { size: 100 };
      if (filterTheaterId) params.theaterId = Number(filterTheaterId);
      if (filterDate) params.date = filterDate;
      const res = await schedulesApi.getSchedules(params);
      setSchedules(res.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load showtimes');
    }
  };

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => schedulesApi.getScheduleSettings())
      .then((settings) => {
        if (!ignore && isValidTimeZone(settings?.zone)) setCinemaZone(settings.zone);
      })
      .catch(() => {
        // Fall back to the browser zone; the form says which zone is in use.
      });
    return () => {
      ignore = true;
    };
  }, []);

  const zoneNote = cinemaZone
    ? `Times are cinema time (${cinemaZone}).`
    : 'Cinema time zone unavailable; times use this browser\'s time zone.';
  const zoneOption = cinemaZone ? { timeZone: cinemaZone } : {};

  // Initial load of movies, theaters and initial schedules
  useEffect(() => {
    let ignore = false;
    Promise.all([
      moviesApi.getMovies({ size: 100 }),
      adminApi.getTheaters(0, 100),
      schedulesApi.getSchedules({ size: 100 }),
    ])
      .then(([moviesRes, theatersRes, schedRes]) => {
        if (!ignore) {
          setMovies(moviesRes.content);
          setTheaters(theatersRes.content);
          setSchedules(schedRes.content);
          if (moviesRes.content.length > 0) {
            setSelectedMovieId(moviesRes.content[0].id);
            setBulkMovieId(moviesRes.content[0].id);
          }
          if (theatersRes.content.length > 0) {
            setSelectedTheaterId(theatersRes.content[0].id);
            setBulkTheaterId(theatersRes.content[0].id);
          }
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load showtime data');
          setIsLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Filter change effect
  useEffect(() => {
    let ignore = false;
    const params: schedulesApi.ScheduleQueryParams = { size: 100 };
    if (filterTheaterId) params.theaterId = Number(filterTheaterId);
    if (filterDate) params.date = filterDate;

    schedulesApi.getSchedules(params)
      .then((res) => {
        if (!ignore) {
          setSchedules(res.content);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to filter showtimes');
        }
      });

    return () => {
      ignore = true;
    };
  }, [filterTheaterId, filterDate]);

  const handleOpenSingleCreate = () => {
    setActiveTab('single');
    setIsFormOpen(true);
    setError(null);
    setSuccess(null);

    setStartDateTime(`${addDaysToDateString(todayInZone(cinemaZone), 1)}T18:00`);
  };

  const handleOpenBulkScheduler = () => {
    setActiveTab('bulk');
    setIsFormOpen(true);
    setError(null);
    setSuccess(null);
    setBulkResults(null);

    const today = todayInZone(cinemaZone);
    setBulkStartDate(today);
    setBulkEndDate(addDaysToDateString(today, 7));
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMovieId || !selectedTheaterId || !startDateTime) return;

    if (vipPrice < basePrice) {
      setError('VIP ticket price cannot be lower than Base ticket price.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const [datePart, timePart] = startDateTime.split('T');
      const startInstant = zonedWallTimeToDate(datePart, timePart.slice(0, 5), cinemaZone).toISOString();
      await adminApi.createSchedule({
        movieId: Number(selectedMovieId),
        theaterId: Number(selectedTheaterId),
        startTime: startInstant,
        basePrice: Number(basePrice),
        vipPrice: Number(vipPrice),
      });

      setSuccess('Showtime created successfully.');
      setIsFormOpen(false);
      await reloadSchedules();
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.status === 409) {
          setError('Conflict: the auditorium is already occupied during this time window (including cleaning buffer).');
        } else {
          setError(err.message || 'Validation error creating showtime.');
        }
      } else {
        setError('Failed to schedule showtime.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkMovieId || !bulkTheaterId || !bulkStartDate || !bulkEndDate) return;

    if (bulkStartDate > bulkEndDate) {
      setError('End Date cannot be before Start Date.');
      return;
    }

    if (bulkVipPrice < bulkBasePrice) {
      setError('VIP ticket price cannot be lower than Base ticket price.');
      return;
    }

    const rawTimes = bulkTimesInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const timeRegex = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
    const invalidTimes = rawTimes.filter((t) => !timeRegex.test(t));
    if (invalidTimes.length > 0 || rawTimes.length === 0) {
      setError(
        invalidTimes.length > 0
          ? `Invalid time format: "${invalidTimes.join(', ')}". Please enter valid 24-hour HH:mm times (00:00 to 23:59), e.g. "14:00, 17:30".`
          : 'Please enter at least one valid time of day (e.g. "14:00, 17:30, 20:30").',
      );
      return;
    }

    const times = rawTimes.map((t) => {
      const [h, m] = t.split(':');
      return `${h.padStart(2, '0')}:${m}`;
    });

    setIsBulkRunning(true);
    setError(null);
    setSuccess(null);
    setBulkResults(null);
    setBulkProgress('Initializing schedule generation…');

    let createdCount = 0;
    let conflictCount = 0;
    let pastCount = 0;
    let errorCount = 0;
    const results: BulkSlotResult[] = [];

    const days = getDaysBetween(bulkStartDate, bulkEndDate);
    const totalSlots = days.length * times.length;
    let currentSlot = 0;
    let sessionExpired = false;

    for (const day of days) {
      if (sessionExpired) break;
      for (const time of times) {
        currentSlot++;
        const slotLabel = `${day} ${time}`;
        setBulkProgress(`Processing slot ${currentSlot} of ${totalSlots} (${slotLabel})…`);

        const dt = zonedWallTimeToDate(day, time, cinemaZone);

        if (dt.getTime() <= Date.now()) {
          pastCount++;
          results.push({ slot: slotLabel, status: 'past', reason: 'Past showtime (skipped)' });
          continue;
        }

        try {
          const startInstant = dt.toISOString();
          await adminApi.createSchedule({
            movieId: Number(bulkMovieId),
            theaterId: Number(bulkTheaterId),
            startTime: startInstant,
            basePrice: Number(bulkBasePrice),
            vipPrice: Number(bulkVipPrice),
          });
          createdCount++;
          results.push({ slot: slotLabel, status: 'created', reason: 'Created successfully' });
        } catch (err) {
          if (err instanceof ApiException) {
            if (err.status === 409) {
              conflictCount++;
              results.push({ slot: slotLabel, status: 'conflict', reason: 'Auditorium occupied (time conflict)' });
            } else if (err.status === 401) {
              errorCount++;
              results.push({ slot: slotLabel, status: 'error', reason: `Permission error (${err.status}): ${err.message || 'Session expired'}` });
              setError('Session expired (401). Please sign in again.');
              sessionExpired = true;
              break;
            } else if (err.status === 403) {
              errorCount++;
              results.push({ slot: slotLabel, status: 'error', reason: `Permission error (${err.status}): ${err.message || 'Forbidden'}` });
            } else {
              errorCount++;
              results.push({ slot: slotLabel, status: 'error', reason: `API error (${err.status}): ${err.message || 'Validation error'}` });
            }
          } else {
            errorCount++;
            results.push({ slot: slotLabel, status: 'error', reason: 'Network or client error' });
          }
        }
      }
    }

    setIsBulkRunning(false);
    setBulkProgress(null);
    setBulkResults(results);
    setSuccess(
      `Bulk generation complete: created ${createdCount} showtimes; ${conflictCount} conflicts, ${pastCount} past, and ${errorCount} errors.`,
    );
    setIsFormOpen(false);
    await reloadSchedules();
  };

  const handleDelete = async (id: number, desc: string) => {
    if (!window.confirm(`Delete showtime: ${desc}?`)) {
      return;
    }

    setDeletingId(id);
    setError(null);
    setSuccess(null);

    try {
      await adminApi.deleteSchedule(id);
      setSuccess(`Showtime #${id} was deleted.`);
      await reloadSchedules();
    } catch (err) {
      if (err instanceof ApiException && err.status === 409) {
        setError(`Cannot delete showtime #${id}: tickets have already been booked or held for this screening.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to delete showtime.');
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AdminLayout
      title="Showtimes & Screening Calendar"
      subtitle="Program film screenings, set admission pricing tiers, and generate bulk schedules."
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
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={filterTheaterId}
            onChange={(e) => setFilterTheaterId(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '2px solid var(--ink)',
              borderRadius: '4px',
              background: '#fff',
              fontFamily: 'inherit',
              fontSize: '14px',
            }}
            aria-label="Filter showtimes by auditorium"
          >
            <option value="">All Auditoriums</option>
            {theaters.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '2px solid var(--ink)',
              borderRadius: '4px',
              background: '#fff',
              fontFamily: 'inherit',
              fontSize: '14px',
            }}
            aria-label="Filter showtimes by date"
          />

          {filterDate && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFilterDate('')}
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              Clear Date
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn red"
            onClick={handleOpenSingleCreate}
            aria-label="Add individual showtime"
          >
            + Add Showtime
          </button>
          <button
            type="button"
            className="btn teal"
            onClick={handleOpenBulkScheduler}
            aria-label="Open bulk recurring scheduler"
          >
            ⚡ Bulk Scheduler
          </button>
        </div>
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

      {bulkResults && bulkResults.length > 0 && (
        <div
          data-testid="bulk-results-panel"
          style={{
            marginBottom: 'var(--space-5)',
            padding: '16px',
            background: '#fff',
            border: '2px solid var(--ink)',
            borderRadius: '4px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Bulk Schedule Slot Report ({bulkResults.length} slots processed)
            </h3>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setBulkResults(null)}
              style={{ padding: '4px 8px', fontSize: '12px' }}
            >
              Dismiss Report
            </button>
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--sand)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--sand-light, #fbf7ee)', textAlign: 'left', borderBottom: '1px solid var(--sand)' }}>
                  <th style={{ padding: '6px 10px' }}>Slot Time</th>
                  <th style={{ padding: '6px 10px' }}>Outcome</th>
                  <th style={{ padding: '6px 10px' }}>Details / Reason</th>
                </tr>
              </thead>
              <tbody>
                {bulkResults.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--sand-light)' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.slot}</td>
                    <td style={{ padding: '6px 10px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          background:
                            r.status === 'created'
                              ? '#d4edda'
                              : r.status === 'conflict'
                              ? '#fff3cd'
                              : r.status === 'past'
                              ? '#e2e3e5'
                              : '#f8d7da',
                          color:
                            r.status === 'created'
                              ? '#155724'
                              : r.status === 'conflict'
                              ? '#856404'
                              : r.status === 'past'
                              ? '#383d41'
                              : '#721c24',
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px', color: '#555' }}>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form / Scheduler Modal Panel */}
      {isFormOpen && (
        <section
          aria-label={activeTab === 'single' ? 'Create Single Showtime' : 'Bulk Showtime Scheduler'}
          className="ticket"
          style={{
            background: '#fff',
            border: '3px solid var(--ink)',
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', gap: '16px', borderBottom: '2px solid var(--sand)', paddingBottom: '12px', marginBottom: '20px' }}>
            <button
              type="button"
              className={activeTab === 'single' ? 'btn red' : 'btn-ghost'}
              onClick={() => setActiveTab('single')}
              style={{ fontSize: '14px', padding: '6px 14px' }}
            >
              Single Showtime
            </button>
            <button
              type="button"
              className={activeTab === 'bulk' ? 'btn teal' : 'btn-ghost'}
              onClick={() => setActiveTab('bulk')}
              style={{ fontSize: '14px', padding: '6px 14px' }}
            >
              Bulk Recurring Scheduler
            </button>
          </div>

          {activeTab === 'single' ? (
            /* Single Showtime Form */
            <form onSubmit={handleSingleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div>
                <label htmlFor="single-movie-select" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Select Film *
                </label>
                <select
                  id="single-movie-select"
                  required
                  value={selectedMovieId}
                  onChange={(e) => setSelectedMovieId(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                >
                  <option value="">— Select Film —</option>
                  {movies.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.durationMinutes}m)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="single-theater-select" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Select Auditorium *
                </label>
                <select
                  id="single-theater-select"
                  required
                  value={selectedTheaterId}
                  onChange={(e) => setSelectedTheaterId(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                >
                  <option value="">— Select Auditorium —</option>
                  {theaters.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.totalSeats} seats)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="single-start-time-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Start Date & Time *
                </label>
                <input
                  id="single-start-time-input"
                  type="datetime-local"
                  required
                  value={startDateTime}
                  onChange={(e) => setStartDateTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--ink-light)' }}>
                  {zoneNote}
                </small>
              </div>

              <div>
                <label htmlFor="single-base-price-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Base Seat Price ($) *
                </label>
                <input
                  id="single-base-price-input"
                  type="number"
                  step="0.5"
                  min="0"
                  required
                  value={basePrice}
                  onChange={(e) => setBasePrice(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label htmlFor="single-vip-price-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  VIP Seat Price ($) *
                </label>
                <input
                  id="single-vip-price-input"
                  type="number"
                  step="0.5"
                  min={basePrice}
                  required
                  value={vipPrice}
                  onChange={(e) => setVipPrice(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  type="submit"
                  className="btn red"
                  disabled={isSaving || !selectedMovieId || !selectedTheaterId || !startDateTime}
                >
                  {isSaving ? 'Scheduling…' : 'Schedule Showtime'}
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
          ) : (
            /* Bulk Scheduler Form */
            <form onSubmit={handleBulkSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div>
                <label htmlFor="bulk-movie-select" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Film to Schedule *
                </label>
                <select
                  id="bulk-movie-select"
                  required
                  value={bulkMovieId}
                  onChange={(e) => setBulkMovieId(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                >
                  <option value="">— Select Film —</option>
                  {movies.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.durationMinutes}m)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="bulk-theater-select" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Auditorium *
                </label>
                <select
                  id="bulk-theater-select"
                  required
                  value={bulkTheaterId}
                  onChange={(e) => setBulkTheaterId(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                >
                  <option value="">— Select Auditorium —</option>
                  {theaters.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.totalSeats} seats)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="bulk-start-date-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Start Date *
                </label>
                <input
                  id="bulk-start-date-input"
                  type="date"
                  required
                  value={bulkStartDate}
                  onChange={(e) => setBulkStartDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label htmlFor="bulk-end-date-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  End Date *
                </label>
                <input
                  id="bulk-end-date-input"
                  type="date"
                  required
                  value={bulkEndDate}
                  onChange={(e) => setBulkEndDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="bulk-times-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Showtimes of Day (comma-separated, 24-hr format) *
                </label>
                <input
                  id="bulk-times-input"
                  type="text"
                  required
                  value={bulkTimesInput}
                  onChange={(e) => setBulkTimesInput(e.target.value)}
                  placeholder="e.g. 13:00, 16:30, 20:00"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--ink-light)' }}>
                  {zoneNote}
                </small>
                <span className="soft" style={{ fontSize: '12px' }}>
                  The scheduler will create screenings on each day across the date range. Overlapping or conflicting slots will be safely skipped.
                </span>
              </div>

              <div>
                <label htmlFor="bulk-base-price-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Base Seat Price ($) *
                </label>
                <input
                  id="bulk-base-price-input"
                  type="number"
                  step="0.5"
                  min="0"
                  required
                  value={bulkBasePrice}
                  onChange={(e) => setBulkBasePrice(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label htmlFor="bulk-vip-price-input" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  VIP Seat Price ($) *
                </label>
                <input
                  id="bulk-vip-price-input"
                  type="number"
                  step="0.5"
                  min={bulkBasePrice}
                  required
                  value={bulkVipPrice}
                  onChange={(e) => setBulkVipPrice(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: '4px',
                    background: 'var(--sand-light, #fbf7ee)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                {bulkProgress && (
                  <div style={{ marginBottom: '12px', fontStyle: 'italic', color: 'var(--teal)', fontWeight: 'bold' }}>
                    ⏳ {bulkProgress}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="submit"
                    className="btn teal"
                    disabled={isBulkRunning || !bulkMovieId || !bulkTheaterId || !bulkStartDate || !bulkEndDate}
                  >
                    {isBulkRunning ? 'Generating Schedules…' : 'Run Bulk Generation'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setIsFormOpen(false)}
                    disabled={isBulkRunning}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Showtimes Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          <p className="soft">Loading showtimes calendar…</p>
        </div>
      ) : schedules.length === 0 ? (
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
            {filterDate || filterTheaterId
              ? 'No showtimes found matching the current filters.'
              : 'No upcoming showtimes scheduled. Use the buttons above to schedule screenings.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ID</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Film Title</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Auditorium</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date & Screening Time</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pricing</th>
                <th style={{ padding: '12px 16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => {
                const start = new Date(s.startTime);
                const end = new Date(s.endTime);
                const dateStr = start.toLocaleDateString(undefined, {
                  ...zoneOption,
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const timeStr = `${start.toLocaleTimeString([], { ...zoneOption, hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { ...zoneOption, hour: '2-digit', minute: '2-digit' })}`;

                return (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: '1px solid var(--sand)',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--teal)', fontFamily: 'monospace' }}>
                      #{s.id}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: '15px' }}>
                      {s.movieTitle}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px' }}>
                      <span className="badge" style={{ background: 'var(--sand-light, #fbf7ee)', border: '1px solid var(--ink)', padding: '2px 8px' }}>
                        {s.theaterName}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px' }}>
                      <strong>{dateStr}</strong>
                      <span className="soft" style={{ display: 'block', fontSize: '13px' }}>
                        {timeStr}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontFamily: 'monospace' }}>
                      <span>Normal: ${s.basePrice.toFixed(2)}</span>
                      <span className="soft" style={{ display: 'block', color: 'var(--mustard)', fontWeight: 'bold' }}>
                        VIP: ${s.vipPrice.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn-ghost danger"
                        onClick={() => handleDelete(s.id, `${s.movieTitle} @ ${s.theaterName} (${dateStr} ${timeStr})`)}
                        disabled={deletingId === s.id}
                        aria-label={`Delete showtime #${s.id}`}
                      >
                        {deletingId === s.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
