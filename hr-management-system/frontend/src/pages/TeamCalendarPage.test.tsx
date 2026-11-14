import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/api';
import type { LeaveCalendarEntry } from '../api/types';
import { monthInputValue, monthRange } from '../lib/dates';
import { TeamCalendarPage } from './TeamCalendarPage';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function months(): { first: { year: number; month: number }; second: { year: number; month: number } } {
  const now = new Date();
  const first = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const next = new Date(first.year, first.month, 1);
  return { first, second: { year: next.getFullYear(), month: next.getMonth() + 1 } };
}

function pickMonth(year: number, month: number): void {
  fireEvent.change(screen.getByLabelText('Pick a month'), { target: { value: monthInputValue(year, month) } });
}

function entry(date: string, employeeName: string): LeaveCalendarEntry {
  return {
    requestId: employeeName,
    employeeId: employeeName,
    employeeName,
    leaveType: 'ANNUAL',
    startDate: date,
    endDate: date,
    workingDays: 1,
  };
}

describe('team calendar month changes', () => {
  it('hides the previous month immediately while loading, then renders only the new month', async () => {
    const { first, second } = months();
    const firstRange = monthRange(first.year, first.month);
    const secondRange = monthRange(second.year, second.month);
    const pending = deferred<LeaveCalendarEntry[]>();
    const fetch = vi.spyOn(api, 'leaveCalendar').mockImplementation((from) =>
      from === firstRange.from
        ? Promise.resolve([entry(firstRange.from, 'Previous Employee')])
        : pending.promise,
    );

    render(<TeamCalendarPage />);
    expect(await screen.findByRole('row', { name: /Previous Employee/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Leave in/ })).toHaveTextContent('Previous Employee');

    pickMonth(second.year, second.month);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the calendar…');
    expect(screen.queryByText('Previous Employee')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(secondRange.from, secondRange.to, expect.any(AbortSignal));

    await act(async () => pending.resolve([entry(secondRange.from, 'Current Employee')]));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Current Employee')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Leave in/ })).toHaveTextContent('Current Employee');
    expect(screen.queryByText('Previous Employee')).not.toBeInTheDocument();
  });

  it('shows the new month empty state, not the old entries', async () => {
    const { first, second } = months();
    const firstRange = monthRange(first.year, first.month);
    vi.spyOn(api, 'leaveCalendar').mockImplementation((from) =>
      Promise.resolve(from === firstRange.from ? [entry(firstRange.from, 'Previous Employee')] : []),
    );

    render(<TeamCalendarPage />);
    expect(await screen.findByRole('row', { name: /Previous Employee/ })).toBeInTheDocument();
    pickMonth(second.year, second.month);
    expect(await screen.findByText('No approved leave this month.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous Employee')).not.toBeInTheDocument();
  });

  it('shows a new month error without the previously loaded entries', async () => {
    const { first, second } = months();
    const firstRange = monthRange(first.year, first.month);
    const failure = deferred<LeaveCalendarEntry[]>();
    vi.spyOn(api, 'leaveCalendar').mockImplementation((from) =>
      from === firstRange.from
        ? Promise.resolve([entry(firstRange.from, 'Previous Employee')])
        : failure.promise,
    );

    render(<TeamCalendarPage />);
    expect(await screen.findByRole('row', { name: /Previous Employee/ })).toBeInTheDocument();
    pickMonth(second.year, second.month);
    await act(async () => failure.reject(new Error('Calendar unavailable')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar unavailable');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No approved leave this month.')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous Employee')).not.toBeInTheDocument();
  });

  it('ignores a late response from an abandoned month', async () => {
    const { first, second } = months();
    const firstRange = monthRange(first.year, first.month);
    const secondRange = monthRange(second.year, second.month);
    const late = deferred<LeaveCalendarEntry[]>();
    const pending = deferred<LeaveCalendarEntry[]>();
    vi.spyOn(api, 'leaveCalendar').mockImplementation((from) =>
      from === firstRange.from ? late.promise : pending.promise,
    );

    render(<TeamCalendarPage />);
    pickMonth(second.year, second.month);
    await act(async () => late.resolve([entry(firstRange.from, 'Late Previous Employee')]));
    expect(screen.queryByText('Late Previous Employee')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the calendar…');

    await act(async () => pending.resolve([entry(secondRange.from, 'Current Employee')]));
    expect(await screen.findByRole('row', { name: /Current Employee/ })).toBeInTheDocument();
    expect(screen.queryByText('Late Previous Employee')).not.toBeInTheDocument();
  });
});
