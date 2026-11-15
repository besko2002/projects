import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/api';
import { errorMessage } from '../api/ApiError';
import type { AttendanceRangeResponse, EmployeeProfile, SessionResponse } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { Banner } from '../components/Banner';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { Card, EmptyState, Loading, PageHeader } from '../components/states';
import { useToast } from '../components/useToast';
import { currentMonth, currentYear, monthInputValue, monthRange, parseMonthInput } from '../lib/dates';
import { formatDate, formatMinutes, formatPeriod } from '../lib/format';
import { useResource } from '../lib/useResource';

function utcInput(value: string): string {
  return new Date(value).toISOString().slice(0, -1);
}

function utcLabel(value: string | null): string {
  return value === null ? 'Still open' : new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

export function EmployeeAttendancePage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const today = useResource<AttendanceRangeResponse>(
    (signal) => api.myAttendanceToday(signal),
    'attendance-business-today',
  );
  if (today.loading && today.data === null && today.error === null) {
    return <Loading label="Loading company calendar…" />;
  }
  const defaultDate = today.data?.from;
  return <AttendanceEditor key={`${id}-${defaultDate ?? 'default'}`} employeeId={id} defaultDate={defaultDate} />;
}

function AttendanceEditor({ employeeId, defaultDate }: { employeeId: string; defaultDate?: string }): JSX.Element {
  const { user, role } = useAuth();
  const toast = useToast();
  const initialYear = defaultDate ? Number(defaultDate.slice(0, 4)) : currentYear();
  const initialMonth = defaultDate ? Number(defaultDate.slice(5, 7)) : currentMonth();
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const range = monthRange(year, month);
  const employee = useResource<EmployeeProfile>((signal) => api.getEmployee(employeeId, signal), `attendance-employee-${employeeId}`);
  const attendance = useResource<AttendanceRangeResponse>(
    (signal) => api.employeeAttendance(employeeId, range.from, range.to, signal),
    `employee-attendance-${employeeId}-${range.from}-${range.to}`,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SessionResponse | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRepair = user !== null && user.id !== employeeId && (role === 'HR' || role === 'ADMIN');
  const sessions = attendance.data?.days.flatMap((day) => day.sessions) ?? [];

  function open(session: SessionResponse | null): void {
    setEditing(session);
    setCheckIn(utcInput(session?.checkIn ?? new Date().toISOString()));
    setCheckOut(session?.checkOut ? utcInput(session.checkOut) : '');
    setReason('');
    setError(null);
    setDialogOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canRepair || busy) return;
    const start = new Date(`${checkIn}Z`);
    const end = checkOut ? new Date(`${checkOut}Z`) : null;
    if (!checkIn || !Number.isFinite(start.getTime()) || (end !== null && !Number.isFinite(end.getTime()))) {
      setError('Enter valid UTC check-in and check-out times.');
      return;
    }
    if (end !== null && end.getTime() <= start.getTime()) {
      setError('Check-out must be after check-in.');
      return;
    }
    if (!reason.trim() || reason.trim().length > 500) {
      setError('Enter an audit reason of 1 to 500 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { checkIn: start.toISOString(), checkOut: end?.toISOString() ?? null, reason: reason.trim() };
      if (editing === null) {
        await api.addAttendanceSession(employeeId, body);
      } else {
        await api.correctAttendanceSession(editing.id, body);
      }
      setDialogOpen(false);
      attendance.reload();
      toast.success(editing === null ? 'Missing attendance session added.' : 'Attendance session corrected.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={`Attendance: ${employee.data?.fullName ?? 'Employee'}`} subtitle="Review sessions and repair missing or incorrect attendance before running payroll."
        actions={<Link to={`/employees/${employeeId}`}>Back to employee</Link>} />
      {employee.loading && <Loading label="Loading employee…" />}
      {employee.error !== null && <Banner>{employee.error}</Banner>}
      {!canRepair && <Banner tone="warning">You can review your attendance here, but another HR or administrator must make corrections to your own record.</Banner>}
      <Card title={formatPeriod(year, month)} actions={
        <div className="button-row">
          <label className="inline-field"><span>Month</span><input type="month" aria-label="Pick a month" value={monthInputValue(year, month)}
            onChange={(event) => { const parsed = parseMonthInput(event.target.value); if (parsed !== null) { setYear(parsed.year); setMonth(parsed.month); } }} /></label>
          {canRepair && <button type="button" className="button button-primary" disabled={employee.data === null || attendance.loading || attendance.error !== null} onClick={() => open(null)}>Add missing session</button>}
        </div>
      }>
        <p className="muted">Session timestamps below and correction inputs use UTC (+00:00), including on daylight-saving transition days. The server determines the work date using the company time zone. Finalized payslips are immutable; correcting attendance does not change them.</p>
        {attendance.loading && <Loading label="Loading attendance…" />}
        {attendance.error !== null && <Banner>{attendance.error}<button type="button" className="button" onClick={attendance.reload}>Retry</button></Banner>}
        {!attendance.loading && attendance.error === null && attendance.data !== null && (
          <>
            <dl className="stat-row"><div className="stat"><dt>Worked</dt><dd>{formatMinutes(attendance.data.workedMinutes)}</dd></div><div className="stat"><dt>Missing check-out days</dt><dd>{attendance.data.missingCheckoutDays}</dd></div><div className="stat"><dt>Absent days</dt><dd>{attendance.data.absentDays}</dd></div></dl>
            {sessions.length === 0 ? <EmptyState title="No sessions in this month." hint="Use Add missing session to repair an unrecorded working day." /> : (
              <div style={{ overflowX: 'auto' }}><table className="table"><caption className="sr-only">Employee attendance sessions</caption><thead><tr><th>Work date</th><th>Check-in (UTC)</th><th>Check-out (UTC)</th><th>Worked</th><th>Source / reason</th><th>Action</th></tr></thead><tbody>
                {sessions.map((session) => <tr key={session.id}><th scope="row">{formatDate(session.workDate)}</th><td>{utcLabel(session.checkIn)}</td><td>{utcLabel(session.checkOut)}</td><td>{session.minutes === null ? '—' : formatMinutes(session.minutes)}</td><td>{session.source}{session.correctionReason && <p className="muted">{session.correctionReason}</p>}</td><td>{canRepair && <button type="button" className="button button-small" onClick={() => open(session)} aria-label={`Correct session ${session.id}`}>Correct</button>}</td></tr>)}
              </tbody></table></div>
            )}
          </>
        )}
      </Card>
      {dialogOpen && <Modal title={editing === null ? 'Add missing session' : 'Correct attendance session'} onClose={() => { if (!busy) setDialogOpen(false); }} footer={
        <><button type="button" className="button" disabled={busy} onClick={() => setDialogOpen(false)}>Cancel</button><button type="submit" form="attendance-repair" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save attendance'}</button></>
      }>
        <form id="attendance-repair" noValidate onSubmit={(event) => { void save(event); }}>
          <p>Enter UTC times (+00:00). A reason is required and retained with the correction.</p>
          <Field id="repair-check-in" label="Check-in (UTC)" required><input id="repair-check-in" type="datetime-local" step="0.001" required disabled={busy} value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></Field>
          <Field id="repair-check-out" label="Check-out (UTC)" hint="Leave blank only for a session that is still open."><input id="repair-check-out" type="datetime-local" step="0.001" disabled={busy} value={checkOut} aria-describedby="repair-check-out-hint" onChange={(event) => setCheckOut(event.target.value)} /></Field>
          <Field id="repair-reason" label="Audit reason" required><textarea id="repair-reason" required maxLength={500} rows={3} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          {error !== null && <Banner>{error}</Banner>}
        </form>
      </Modal>}
    </>
  );
}
