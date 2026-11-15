import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SessionResponse } from '../api/types';
import { FORBIDDEN_TITLE } from '../lib/messages';
import { makeAttendanceRange, makeDay, makeEmployee, signedIn } from '../test/fixtures';
import { installFetchMock, type RouteHandler } from '../test/fetchMock';
import { renderApp } from '../test/helpers';

const session: SessionResponse = {
  id: 'session-7', employeeId: 'emp-7', workDate: '2026-11-10', checkIn: '2026-11-10T07:00:00.123Z', checkOut: '2026-11-10T15:00:00.456Z',
  localCheckIn: '2026-11-10T09:00:00.123', localCheckOut: '2026-11-10T17:00:00.456', minutes: 480,
  source: 'SELF', correctedById: null, correctionReason: null,
};
function routes(overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> {
  return {
    ...signedIn({ role: 'HR', me: { id: 'hr-1' } }),
    'GET /api/attendance/today': { body: makeAttendanceRange({ from: '2026-11-10', to: '2026-11-10', days: [makeDay({ day: '2026-11-10' })] }) },
    'GET /api/employees/emp-7': { body: makeEmployee({ id: 'emp-7', fullName: 'Rana Hussein' }) },
    'GET /api/attendance/employees/emp-7': { body: makeAttendanceRange({ employeeId: 'emp-7', days: [makeDay({ day: session.workDate, sessions: [session] })] }) },
    ...overrides,
  };
}

describe('HR attendance repair', () => {
  it('shows employee sessions and explicitly labels correction times in UTC', async () => {
    installFetchMock(routes());
    renderApp('/employees/emp-7/attendance');
    await screen.findByRole('table', { name: 'Employee attendance sessions' });
    expect(screen.getByText('2026-11-10 07:00:00.123 UTC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add missing session' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Correct session session-7' })).toBeEnabled();
  });

  it('adds a missing session with UTC instants and an audit reason, then reloads', async () => {
    const mock = installFetchMock(routes({ 'POST /api/attendance/employees/emp-7/sessions': { status: 201, body: session } }));
    const user = userEvent.setup();
    renderApp('/employees/emp-7/attendance');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add missing session' }));
    fireEvent.change(screen.getByLabelText('Check-in (UTC)', { exact: false }), { target: { value: '2026-11-09T07:00' } });
    fireEvent.change(screen.getByLabelText('Check-out (UTC)'), { target: { value: '2026-11-09T15:00' } });
    await user.type(screen.getByLabelText(/Audit reason/), '  Missing clock record  ');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await screen.findByText('Missing attendance session added.');
    expect(mock.callsTo('POST /api/attendance/employees/emp-7/sessions')[0].body).toEqual({ checkIn: '2026-11-09T07:00:00.000Z', checkOut: '2026-11-09T15:00:00.000Z', reason: 'Missing clock record' });
    expect(mock.urlsFor('GET', '/api/attendance/employees/emp-7').length).toBeGreaterThanOrEqual(2);
  });

  it('corrects an existing session without losing subsecond precision', async () => {
    const mock = installFetchMock(routes({ 'POST /api/attendance/sessions/session-7/correct': { body: session } }));
    const user = userEvent.setup();
    renderApp('/employees/emp-7/attendance');
    await user.click(await screen.findByRole('button', { name: 'Correct session session-7' }));
    fireEvent.change(screen.getByLabelText('Check-out (UTC)'), { target: { value: '2026-11-10T16:00' } });
    await user.type(screen.getByLabelText(/Audit reason/), 'Correct missing hour');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await screen.findByText('Attendance session corrected.');
    expect(mock.callsTo('POST /api/attendance/sessions/session-7/correct')[0].body).toEqual({ checkIn: session.checkIn, checkOut: '2026-11-10T16:00:00.000Z', reason: 'Correct missing hour' });
  });

  it('requires a reason and keeps a conflicting correction open for repair', async () => {
    const mock = installFetchMock(routes({ 'POST /api/attendance/sessions/session-7/correct': { status: 409, body: { status: 409, message: 'The session overlaps another attendance session' } } }));
    const user = userEvent.setup();
    renderApp('/employees/emp-7/attendance');
    await user.click(await screen.findByRole('button', { name: 'Correct session session-7' }));
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Enter an audit reason of 1 to 500 characters.')).toBeInTheDocument();
    expect(mock.callsTo('POST /api/attendance/sessions/session-7/correct')).toHaveLength(0);
    await user.type(screen.getByLabelText(/Audit reason/), 'Reviewed original record');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('The session overlaps another attendance session')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not allow HR to repair their own attendance', async () => {
    installFetchMock(routes({ ...signedIn({ role: 'HR', me: { id: 'emp-7' } }) }));
    renderApp('/employees/emp-7/attendance');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Add missing session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct session session-7' })).not.toBeInTheDocument();
    expect(screen.getByText(/another HR or administrator must make corrections/)).toBeInTheDocument();
  });

  it('guards the repair route from ordinary employees', async () => {
    const mock = installFetchMock(routes({ ...signedIn({ role: 'EMPLOYEE' }) }));
    renderApp('/employees/emp-7/attendance');
    await screen.findByRole('heading', { name: FORBIDDEN_TITLE });
    await waitFor(() => expect(mock.urlsFor('GET', '/api/attendance/employees/emp-7')).toHaveLength(0));
  });

  it('opens on the company calendar month from /api/attendance/today', async () => {
    installFetchMock(routes({
      'GET /api/attendance/today': { body: makeAttendanceRange({ from: '2028-05-15', to: '2028-05-15', days: [makeDay({ day: '2028-05-15' })] }) },
      'GET /api/attendance/employees/emp-7': { body: makeAttendanceRange({ from: '2028-05-01', to: '2028-05-31', employeeId: 'emp-7', days: [] }) },
    }));
    renderApp('/employees/emp-7/attendance');
    expect(await screen.findByLabelText('Pick a month')).toHaveValue('2028-05');
  });
});
