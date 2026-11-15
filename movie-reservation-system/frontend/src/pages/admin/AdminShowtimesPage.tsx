import React, { useEffect, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import * as moviesApi from '../../api/moviesApi';
import * as schedulesApi from '../../api/schedulesApi';
import * as adminApi from '../../api/adminApi';
import { ApiException } from '../../api/client';
import type { MovieSummary } from '../../types/movie';
import type { ScheduleSummary } from '../../types/schedule';
import type { TheaterSummary } from '../../types/admin';

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

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);
    setStartDateTime(localISOTime);
  };

  const handleOpenBulkScheduler = () => {
    setActiveTab('bulk');
    setIsFormOpen(true);
    setError(null);
    setSuccess(null);

    const today = new Date();
    const future = new Date();
    future.setDate(today.getDate() + 7);

    setBulkStartDate(today.toISOString().slice(0, 10));
    setBulkEndDate(future.toISOString().slice(0, 10));
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
      const startInstant = new Date(startDateTime).toISOString();
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

    if (bulkVipPrice < bulkBasePrice) {
      setError('VIP ticket price cannot be lower than Base ticket price.');
      return;
    }

    const times = bulkTimesInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^\d{1,2}:\d{2}$/.test(t));

    if (times.length === 0) {
      setError('Please enter at least one valid time of day (e.g. "14:00, 17:30, 20:30").');
      return;
    }

    setIsBulkRunning(true);
    setError(null);
    setSuccess(null);
    setBulkProgress('Initializing schedule generation…');

    let createdCount = 0;
    let skippedCount = 0;

    const start = new Date(`${bulkStartDate}T00:00:00`);
    const end = new Date(`${bulkEndDate}T23:59:59`);

    const days: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    const totalSlots = days.length * times.length;
    let currentSlot = 0;

    for (const day of days) {
      for (const time of times) {
        currentSlot++;
        setBulkProgress(`Processing slot ${currentSlot} of ${totalSlots} (${day} ${time})…`);

        try {
          const dt = new Date(`${day}T${time}:00`);
          if (dt.getTime() <= Date.now()) {
            skippedCount++;
            continue;
          }

          const startInstant = dt.toISOString();
          await adminApi.createSchedule({
            movieId: Number(bulkMovieId),
            theaterId: Number(bulkTheaterId),
            startTime: startInstant,
            basePrice: Number(bulkBasePrice),
            vipPrice: Number(bulkVipPrice),
          });
          createdCount++;
        } catch {
          skippedCount++;
        }
      }
    }

    setIsBulkRunning(false);
    setBulkProgress(null);
    setSuccess(`Bulk generation complete: created ${createdCount} showtimes; ${skippedCount} conflicting or past slots were skipped.`);
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
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

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
                        className="btn-ghost"
                        onClick={() => handleDelete(s.id, `${s.movieTitle} @ ${s.theaterName} (${dateStr} ${timeStr})`)}
                        disabled={deletingId === s.id}
                        style={{
                          padding: '4px 10px',
                          fontSize: '13px',
                          color: 'var(--red)',
                          borderColor: 'var(--red)',
                        }}
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
