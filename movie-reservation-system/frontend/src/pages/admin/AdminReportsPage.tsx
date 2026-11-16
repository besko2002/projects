import React, { useEffect, useRef, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import * as adminApi from '../../api/adminApi';
import * as schedulesApi from '../../api/schedulesApi';
import type { AdminTicket, OccupancyReport, RevenueReport } from '../../types/admin';
import type { ScheduleSummary } from '../../types/schedule';
import { addDaysToDateString, isValidTimeZone, localDayRange, todayInZone } from '../../utils/dateUtils';

export function AdminReportsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'revenue' | 'occupancy' | 'tickets'>('revenue');

  // Report days are cinema days (app.schedule.zone, the zone the daily breakdown uses), not UTC days.
  const [cinemaZone, setCinemaZone] = useState<string | null>(null);
  const datesTouched = useRef(false);
  const [fromDate, setFromDate] = useState<string>(() => addDaysToDateString(todayInZone(null), -30));
  const [toDate, setToDate] = useState<string>(() => todayInZone(null));
  const [revenueData, setRevenueData] = useState<RevenueReport | null>(null);
  const [isRevenueLoading, setIsRevenueLoading] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  // Occupancy report state
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | ''>('');
  const [occupancyData, setOccupancyData] = useState<OccupancyReport | null>(null);
  const [isOccupancyLoading, setIsOccupancyLoading] = useState(false);
  const [occupancyError, setOccupancyError] = useState<string | null>(null);

  // Tickets audit state
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [ticketStatus, setTicketStatus] = useState<string>('');
  const [ticketScheduleId, setTicketScheduleId] = useState<string>('');
  const [ticketUserId, setTicketUserId] = useState<string>('');
  const [ticketPage, setTicketPage] = useState<number>(0);
  const [totalTicketPages, setTotalTicketPages] = useState<number>(1);
  const [isTicketsLoading, setIsTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  // Load schedules once for occupancy dropdown
  useEffect(() => {
    let ignore = false;
    schedulesApi.getSchedules({ size: 100 })
      .then((res) => {
        if (!ignore) {
          setSchedules(res.content);
          if (res.content.length > 0) {
            setSelectedScheduleId(res.content[0].id);
          }
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => schedulesApi.getScheduleSettings())
      .then((settings) => {
        if (ignore || !isValidTimeZone(settings?.zone)) return;
        setCinemaZone(settings.zone);
        // Default range = the last 30 cinema days, unless the admin already picked dates.
        if (!datesTouched.current) {
          const today = todayInZone(settings.zone);
          setToDate(today);
          setFromDate(addDaysToDateString(today, -30));
        }
      })
      .catch(() => {
        // Keep the browser's own days if the cinema zone cannot be loaded.
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Fetch Revenue when activeTab is 'revenue' or date range changes
  useEffect(() => {
    if (activeTab !== 'revenue' || !fromDate || !toDate) return;
    let ignore = false;

    const { fromIso, toIso } = localDayRange(fromDate, toDate, cinemaZone);

    adminApi.getRevenueReport(fromIso, toIso)
      .then((res) => {
        if (!ignore) {
          setRevenueData(res);
          setIsRevenueLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setRevenueError(err instanceof Error ? err.message : 'Failed to load revenue report');
          setIsRevenueLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [activeTab, fromDate, toDate, cinemaZone]);

  // Fetch Occupancy when activeTab is 'occupancy' and a schedule is selected
  useEffect(() => {
    if (activeTab !== 'occupancy' || selectedScheduleId === '') return;
    let ignore = false;

    adminApi.getOccupancyReport(Number(selectedScheduleId))
      .then((res) => {
        if (!ignore) {
          setOccupancyData(res);
          setIsOccupancyLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setOccupancyError(err instanceof Error ? err.message : 'Failed to load occupancy report');
          setIsOccupancyLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [activeTab, selectedScheduleId]);

  // Fetch Tickets when activeTab is 'tickets' or query filters change
  useEffect(() => {
    if (activeTab !== 'tickets') return;
    let ignore = false;

    adminApi.getAdminTickets({
      status: ticketStatus || undefined,
      scheduleId: ticketScheduleId ? Number(ticketScheduleId) : undefined,
      userId: ticketUserId ? Number(ticketUserId) : undefined,
      page: ticketPage,
      size: 20,
    })
      .then((res) => {
        if (!ignore) {
          setTickets(res.content);
          setTotalTicketPages(res.totalPages || 1);
          setIsTicketsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setTicketsError(err instanceof Error ? err.message : 'Failed to load tickets');
          setIsTicketsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [activeTab, ticketStatus, ticketScheduleId, ticketUserId, ticketPage]);

  const handleManualRevenueRefresh = async () => {
    setIsRevenueLoading(true);
    setRevenueError(null);
    try {
      const range = fromDate && toDate ? localDayRange(fromDate, toDate, cinemaZone) : null;
      const res = await adminApi.getRevenueReport(range?.fromIso, range?.toIso);
      setRevenueData(res);
    } catch (err) {
      setRevenueError(err instanceof Error ? err.message : 'Failed to load revenue report');
    } finally {
      setIsRevenueLoading(false);
    }
  };

  const formatCurrency = (amount: number | string | undefined | null, curr = 'USD') => {
    const val = typeof amount === 'number' ? amount : Number(amount);
    if (isNaN(val)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
    }).format(val);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <span className="badge" style={{ background: 'var(--teal)', color: '#fff', padding: '3px 8px' }}>PAID</span>;
      case 'PENDING_PAYMENT':
        return <span className="badge" style={{ background: 'var(--mustard)', color: 'var(--ink)', padding: '3px 8px' }}>PENDING</span>;
      case 'CANCELLED':
        return <span className="badge" style={{ background: 'var(--red)', color: '#fff', padding: '3px 8px' }}>CANCELLED</span>;
      case 'REFUNDED':
        return <span className="badge" style={{ background: '#7e22ce', color: '#fff', padding: '3px 8px' }}>REFUNDED</span>;
      default:
        return <span className="badge" style={{ background: 'var(--sand)', color: 'var(--ink)', padding: '3px 8px' }}>{status}</span>;
    }
  };

  return (
    <AdminLayout
      title="Business Reports & Accounting"
      subtitle="Financial performance, hall occupancy metrics, and transactional ticket ledger."
    >
      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '3px solid var(--ink)', paddingBottom: '12px', marginBottom: '24px' }}>
        <button
          type="button"
          className={activeTab === 'revenue' ? 'btn red' : 'btn-ghost'}
          onClick={() => setActiveTab('revenue')}
          style={{ fontSize: '14px', padding: '8px 16px' }}
        >
          💰 Revenue & Financials
        </button>
        <button
          type="button"
          className={activeTab === 'occupancy' ? 'btn teal' : 'btn-ghost'}
          onClick={() => setActiveTab('occupancy')}
          style={{ fontSize: '14px', padding: '8px 16px' }}
        >
          📊 Hall Occupancy
        </button>
        <button
          type="button"
          className={activeTab === 'tickets' ? 'btn mustard' : 'btn-ghost'}
          onClick={() => setActiveTab('tickets')}
          style={{ fontSize: '14px', padding: '8px 16px' }}
        >
          🎟️ Ticket Ledger
        </button>
      </div>

      {/* REVENUE TAB */}
      {activeTab === 'revenue' && (
        <div>
          {/* Date Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
            <div>
              <label htmlFor="revenue-from" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                From Date
              </label>
              <input
                id="revenue-from"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  datesTouched.current = true;
                  setFromDate(e.target.value);
                }}
                style={{
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <label htmlFor="revenue-to" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                To Date
              </label>
              <input
                id="revenue-to"
                type="date"
                value={toDate}
                onChange={(e) => {
                  datesTouched.current = true;
                  setToDate(e.target.value);
                }}
                style={{
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                }}
              />
            </div>

            <button
              type="button"
              className="btn-ghost"
              onClick={handleManualRevenueRefresh}
              disabled={isRevenueLoading}
              style={{ alignSelf: 'flex-end', padding: '8px 16px' }}
            >
              {isRevenueLoading ? 'Calculating…' : 'Refresh Report'}
            </button>
          </div>

          {revenueError && (
            <div className="error-banner" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              {revenueError}
            </div>
          )}

          {isRevenueLoading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
              <p className="soft">Aggregating financial transactions…</p>
            </div>
          ) : revenueData ? (
            <div>
              {/* Financial Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: 'var(--space-8)' }}>
                <div className="ticket" style={{ background: '#fff', border: '2px solid var(--ink)', padding: '16px' }}>
                  <div className="kicker" style={{ color: 'var(--teal)' }}>Gross Sales</div>
                  <div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '6px' }}>
                    {formatCurrency(revenueData.grossRevenue, revenueData.currency)}
                  </div>
                  <div className="soft" style={{ fontSize: '13px', marginTop: '4px' }}>
                    {revenueData.paidTickets} tickets sold
                  </div>
                </div>

                <div className="ticket" style={{ background: '#fff', border: '2px solid var(--ink)', padding: '16px' }}>
                  <div className="kicker" style={{ color: 'var(--red)' }}>Refunds</div>
                  <div style={{ fontSize: '26px', fontWeight: 'bold', color: 'var(--red)', marginTop: '6px' }}>
                    -{formatCurrency(revenueData.refundedAmount, revenueData.currency)}
                  </div>
                  <div className="soft" style={{ fontSize: '13px', marginTop: '4px' }}>
                    {revenueData.refundedTickets} refunded tickets
                  </div>
                </div>

                <div className="ticket" style={{ background: 'var(--sand-light, #fbf7ee)', border: '3px solid var(--ink)', padding: '16px' }}>
                  <div className="kicker" style={{ color: 'var(--mustard)', fontWeight: 'bold' }}>Net Cinema Revenue</div>
                  <div style={{ fontSize: '30px', fontWeight: 'bold', color: 'var(--ink)', marginTop: '6px' }}>
                    {formatCurrency(revenueData.netRevenue, revenueData.currency)}
                  </div>
                  <div className="soft" style={{ fontSize: '13px', marginTop: '4px' }}>
                    Currency: {revenueData.currency}
                  </div>
                </div>
              </div>

              {/* By Movie Breakdown */}
              <div style={{ marginBottom: 'var(--space-8)' }}>
                <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Revenue by Film Feature</h2>
                {revenueData.byMovie && revenueData.byMovie.length > 0 ? (
                  <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                          <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Film</th>
                          <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase', textAlign: 'right' }}>Tickets Sold</th>
                          <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase', textAlign: 'right' }}>Gross Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueData.byMovie.map((m) => {
                          const title = m.title || m.movieTitle || `Movie #${m.movieId}`;
                          const ticketsCount = m.tickets ?? m.paidTickets ?? 0;
                          const revenue = m.revenue ?? m.grossRevenue ?? 0;
                          return (
                            <tr key={m.movieId} style={{ borderBottom: '1px solid var(--sand)' }}>
                              <td style={{ padding: '10px 14px', fontWeight: 600 }}>{title}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'right' }}>{ticketsCount}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                {formatCurrency(revenue, revenueData.currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="soft">No tickets sold in this period.</p>
                )}
              </div>

              {/* By Day Breakdown */}
              <div>
                <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Daily Box Office Breakdown</h2>
                {revenueData.byDay && revenueData.byDay.length > 0 ? (
                  <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                          <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Date</th>
                          <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase', textAlign: 'right' }}>Paid Tickets</th>
                          <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase', textAlign: 'right' }}>Gross Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueData.byDay.map((d) => {
                          const ticketsCount = d.tickets ?? d.paidTickets ?? 0;
                          const revenue = d.revenue ?? d.grossRevenue ?? 0;
                          return (
                            <tr key={d.date} style={{ borderBottom: '1px solid var(--sand)' }}>
                              <td style={{ padding: '10px 14px', fontWeight: 600 }}>{d.date}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'right' }}>{ticketsCount}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                {formatCurrency(revenue, revenueData.currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="soft">No sales recorded during this window.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* OCCUPANCY TAB */}
      {activeTab === 'occupancy' && (
        <div>
          <div style={{ marginBottom: 'var(--space-6)', maxWidth: '480px' }}>
            <label htmlFor="occupancy-schedule-select" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Select Showtime to Analyze
            </label>
            <select
              id="occupancy-schedule-select"
              value={selectedScheduleId}
              onChange={(e) => setSelectedScheduleId(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '2px solid var(--ink)',
                borderRadius: '4px',
                background: '#fff',
                fontFamily: 'inherit',
                fontSize: '14px',
              }}
            >
              <option value="">— Choose a Showtime —</option>
              {schedules.map((s) => {
                const date = new Date(s.startTime).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <option key={s.id} value={s.id}>
                    #{s.id}: {s.movieTitle} ({s.theaterName} – {date})
                  </option>
                );
              })}
            </select>
          </div>

          {occupancyError && (
            <div className="error-banner" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              {occupancyError}
            </div>
          )}

          {isOccupancyLoading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
              <p className="soft">Reading seat map occupancy…</p>
            </div>
          ) : occupancyData ? (
            <div className="ticket" style={{ background: '#fff', border: '3px solid var(--ink)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <div className="kicker" style={{ color: 'var(--teal)' }}>{occupancyData.theaterName}</div>
                  <h2 style={{ margin: '4px 0', fontSize: '24px' }}>{occupancyData.movieTitle}</h2>
                  <p className="soft" style={{ margin: 0, fontSize: '14px' }}>
                    Screening: {new Date(occupancyData.startTime).toLocaleString()}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="kicker" style={{ color: 'var(--mustard)' }}>Revenue Collected</div>
                  <div style={{ fontSize: '26px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    ${Number(occupancyData.revenue).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Occupancy Progress Bar */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '14px', fontWeight: 600 }}>
                  <span>Auditorium Occupancy Rate</span>
                  <span style={{ color: 'var(--teal)', fontSize: '16px' }}>{Number(occupancyData.occupancyPercent).toFixed(1)}%</span>
                </div>
                <div style={{ width: '100%', height: '24px', background: 'var(--sand)', borderRadius: '4px', overflow: 'hidden', border: '2px solid var(--ink)' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, Number(occupancyData.occupancyPercent)))}%`,
                      background: 'var(--teal)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>

              {/* Seat Metric Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                <div style={{ padding: '12px', background: 'var(--sand-light, #fbf7ee)', border: '1px solid var(--sand)', borderRadius: '4px', textAlign: 'center' }}>
                  <div className="soft" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Capacity</div>
                  <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '4px' }}>{occupancyData.capacity}</div>
                </div>
                <div style={{ padding: '12px', background: '#ebfbee', border: '1px solid #c3e6cb', borderRadius: '4px', textAlign: 'center' }}>
                  <div style={{ color: 'var(--teal)', fontSize: '12px', textTransform: 'uppercase', fontWeight: 'bold' }}>Booked (Paid)</div>
                  <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--teal)', marginTop: '4px' }}>{occupancyData.bookedSeats}</div>
                </div>
                <div style={{ padding: '12px', background: '#fff9db', border: '1px solid #ffe066', borderRadius: '4px', textAlign: 'center' }}>
                  <div style={{ color: '#d97706', fontSize: '12px', textTransform: 'uppercase', fontWeight: 'bold' }}>Active Holds</div>
                  <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#d97706', marginTop: '4px' }}>{occupancyData.heldSeats}</div>
                </div>
                <div style={{ padding: '12px', background: 'var(--sand-light, #fbf7ee)', border: '1px solid var(--sand)', borderRadius: '4px', textAlign: 'center' }}>
                  <div className="soft" style={{ fontSize: '12px', textTransform: 'uppercase' }}>Available</div>
                  <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '4px' }}>{occupancyData.availableSeats}</div>
                </div>
              </div>
            </div>
          ) : (
            <p className="soft">Please select a showtime to view seating capacity and occupancy statistics.</p>
          )}
        </div>
      )}

      {/* TICKETS TAB */}
      {activeTab === 'tickets' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-6)' }}>
            <div>
              <label htmlFor="ticket-filter-status" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Status
              </label>
              <select
                id="ticket-filter-status"
                value={ticketStatus}
                onChange={(e) => {
                  setTicketStatus(e.target.value);
                  setTicketPage(0);
                }}
                style={{
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                }}
              >
                <option value="">All Statuses</option>
                <option value="PAID">PAID</option>
                <option value="PENDING_PAYMENT">PENDING_PAYMENT</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="REFUNDED">REFUNDED</option>
                <option value="EXPIRED">EXPIRED</option>
              </select>
            </div>

            <div>
              <label htmlFor="ticket-filter-schedule" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Schedule ID
              </label>
              <input
                id="ticket-filter-schedule"
                type="number"
                placeholder="e.g. 101"
                value={ticketScheduleId}
                onChange={(e) => {
                  setTicketScheduleId(e.target.value);
                  setTicketPage(0);
                }}
                style={{
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  width: '120px',
                }}
              />
            </div>

            <div>
              <label htmlFor="ticket-filter-user" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                User ID
              </label>
              <input
                id="ticket-filter-user"
                type="number"
                placeholder="e.g. 5"
                value={ticketUserId}
                onChange={(e) => {
                  setTicketUserId(e.target.value);
                  setTicketPage(0);
                }}
                style={{
                  padding: '8px 12px',
                  border: '2px solid var(--ink)',
                  borderRadius: '4px',
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  width: '100px',
                }}
              />
            </div>

            {(ticketStatus || ticketScheduleId || ticketUserId) && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setTicketStatus('');
                  setTicketScheduleId('');
                  setTicketUserId('');
                  setTicketPage(0);
                }}
                style={{ padding: '8px 12px', fontSize: '13px' }}
              >
                Reset Filters
              </button>
            )}
          </div>

          {ticketsError && (
            <div className="error-banner" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              {ticketsError}
            </div>
          )}

          {isTicketsLoading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
              <p className="soft">Querying ticket transaction ledger…</p>
            </div>
          ) : tickets.length === 0 ? (
            <div className="ticket" style={{ background: '#fff', border: '2px dashed var(--sand)', padding: 'var(--space-8)', textAlign: 'center' }}>
              <p className="soft" style={{ fontSize: '16px', margin: 0 }}>
                No tickets match the query parameters.
              </p>
            </div>
          ) : (
            <div>
              <div style={{ overflowX: 'auto', border: '2px solid var(--ink)', borderRadius: '4px', background: '#fff', marginBottom: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--sand-light, #fbf7ee)', borderBottom: '2px solid var(--ink)' }}>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Ticket #</th>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>User</th>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Screening</th>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Status</th>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Seats</th>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase', textAlign: 'right' }}>Total</th>
                      <th style={{ padding: '10px 14px', fontSize: '13px', textTransform: 'uppercase' }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--sand)' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                          #{t.id}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '13px' }}>
                          User #{t.userId}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '13px' }}>
                          <strong>{t.movieTitle || `Schedule #${t.scheduleId}`}</strong>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {getStatusBadge(t.status)}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '13px' }}>
                          {t.seats && t.seats.length > 0
                            ? t.seats.map((s) => `${s.rowLabel}${s.seatNumber}`).join(', ')
                            : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                          ${Number(t.totalPrice || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--ink-soft)' }}>
                          {new Date(t.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={ticketPage === 0}
                  onClick={() => setTicketPage((p) => Math.max(0, p - 1))}
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                >
                  ← Previous
                </button>
                <span className="soft" style={{ fontSize: '13px' }}>
                  Page {ticketPage + 1} of {totalTicketPages}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={ticketPage >= totalTicketPages - 1}
                  onClick={() => setTicketPage((p) => p + 1)}
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
