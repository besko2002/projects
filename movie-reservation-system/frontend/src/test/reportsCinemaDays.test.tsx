import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminReportsPage } from '../pages/admin/AdminReportsPage';
import * as adminApi from '../api/adminApi';
import * as schedulesApi from '../api/schedulesApi';

vi.mock('../api/adminApi');
vi.mock('../api/schedulesApi');

describe('Admin revenue report covers whole cinema days, not UTC days', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // 20:00 UTC on 15 Nov is already 05:00 on 16 Nov in Tokyo.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T20:00:00Z'));
    vi.mocked(schedulesApi.getSchedules).mockResolvedValue({
      content: [], page: 0, size: 100, totalElements: 0, totalPages: 1, last: true,
    });
    vi.mocked(schedulesApi.getScheduleSettings).mockResolvedValue({ zone: 'Asia/Tokyo', bufferMinutes: 15 });
    vi.mocked(adminApi.getRevenueReport).mockResolvedValue({
      from: '', to: '', currency: 'USD', paidTickets: 0, grossRevenue: 0,
      refundedTickets: 0, refundedAmount: 0, netRevenue: 0, byMovie: [], byDay: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to the last 30 cinema days and asks for [first day 00:00, day after last 00:00) in the cinema zone', async () => {
    render(
      <MemoryRouter>
        <AdminReportsPage />
      </MemoryRouter>,
    );

    // Tokyo "today" is 16 Nov: window 17 Oct 00:00 JST .. 17 Nov 00:00 JST (exclusive) = 15:00 UTC the day before.
    await waitFor(() =>
      expect(adminApi.getRevenueReport).toHaveBeenLastCalledWith('2026-10-16T15:00:00.000Z', '2026-11-16T15:00:00.000Z'),
    );
  });
});
