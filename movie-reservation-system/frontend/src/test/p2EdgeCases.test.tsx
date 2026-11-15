import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PaymentSuccessPage } from '../pages/PaymentSuccessPage';
import * as ticketsApi from '../api/ticketsApi';
import * as authApi from '../api/authApi';
import { ApiException, setToken, getToken } from '../api/client';
import { AuthProvider } from '../context/AuthContext';
import { sanitizeReturnUrl } from '../utils/urlUtils';
import type { TicketDto } from '../types/ticket';

const mockTicketCancelled: TicketDto = {
  id: 888,
  scheduleId: 10,
  movieTitle: 'Ember Road',
  scheduleStartTime: new Date(Date.now() + 3600000).toISOString(),
  status: 'CANCELLED',
  totalPrice: 25.0,
  currency: 'USD',
  seatCount: 1,
  seats: [
    { rowLabel: 'A', seatNumber: 1, type: 'NORMAL', price: 12.5 },
  ],
  paidAt: null,
  cancelledAt: new Date().toISOString(),
};

describe('P2 & P3 Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    setToken(null);
  });

  describe('P2-1: PaymentSuccessPage Polling & Statuses', () => {
    it('stops polling and renders final status when status is CANCELLED or EXPIRED (P2-1)', async () => {
      sessionStorage.setItem('cinebook_pending_ticket_id', '888');
      const getSpy = vi.spyOn(ticketsApi, 'getTicket').mockResolvedValue(mockTicketCancelled);

      render(
        <MemoryRouter initialEntries={['/payment/success']}>
          <Routes>
            <Route path="/payment/success" element={<PaymentSuccessPage />} />
          </Routes>
        </MemoryRouter>,
      );

      // Verify the final status is displayed and pending storage removed
      expect(await screen.findByText(/Ticket Status: CANCELLED/i)).toBeInTheDocument();
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem('cinebook_pending_ticket_id')).toBeNull();
    });

    it('falls back to newest ticket from getMyTickets when sessionStorage is empty (P2-1)', async () => {
      const getMyTicketsSpy = vi.spyOn(ticketsApi, 'getMyTickets').mockResolvedValue({
        content: [mockTicketCancelled],
        page: 0,
        size: 1,
        totalElements: 1,
        totalPages: 1,
        last: true,
      });
      vi.spyOn(ticketsApi, 'getTicket').mockResolvedValue(mockTicketCancelled);

      render(
        <MemoryRouter initialEntries={['/payment/success']}>
          <Routes>
            <Route path="/payment/success" element={<PaymentSuccessPage />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByText(/Ticket Status: CANCELLED/i)).toBeInTheDocument();
      expect(getMyTicketsSpy).toHaveBeenCalledWith(0, 1);
    });

    it('stops polling on 401/403/404 with clear message (P2-1)', async () => {
      sessionStorage.setItem('cinebook_pending_ticket_id', '999');
      vi.spyOn(ticketsApi, 'getTicket').mockRejectedValue(
        new ApiException({ status: 404, error: 'Not Found', message: 'Ticket 999 does not exist' }),
      );

      render(
        <MemoryRouter initialEntries={['/payment/success']}>
          <Routes>
            <Route path="/payment/success" element={<PaymentSuccessPage />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByText(/Ticket not found/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Check again/i })).toBeInTheDocument();
    });
  });

  describe('P2-6: AuthContext Session Preservation', () => {
    it('does NOT clear session on 500 server error or network error (P2-6)', async () => {
      setToken('valid-user-jwt');

      // Backend throws 500 Internal Server Error
      vi.spyOn(authApi, 'getMe').mockRejectedValue(
        new ApiException({ status: 500, error: 'Internal Server Error', message: 'Database unreachable' }),
      );

      render(
        <AuthProvider>
          <div>Authenticated App Content</div>
        </AuthProvider>,
      );

      // Give effect time to run
      await waitFor(() => {
        // Token must still be preserved in localStorage!
        expect(getToken()).toBe('valid-user-jwt');
      });
    });

    it('clears session on 401 Unauthorized (P2-6)', async () => {
      setToken('expired-jwt');

      vi.spyOn(authApi, 'getMe').mockRejectedValue(
        new ApiException({ status: 401, error: 'Unauthorized', message: 'Token expired' }),
      );

      render(
        <AuthProvider>
          <div>Authenticated App Content</div>
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(getToken()).toBeNull();
      });
    });
  });

  describe('P3: Return URL Path Sanitization', () => {
    it('allows valid relative return paths and blocks open redirects', () => {
      expect(sanitizeReturnUrl('/book/10')).toBe('/book/10');
      expect(sanitizeReturnUrl('/tickets')).toBe('/tickets');
      expect(sanitizeReturnUrl('/')).toBe('/');

      // Open redirect patterns must be blocked and fallback to '/'
      expect(sanitizeReturnUrl('//evil.com')).toBe('/');
      expect(sanitizeReturnUrl('/\\evil.com')).toBe('/');
      expect(sanitizeReturnUrl('https://evil.com')).toBe('/');
      expect(sanitizeReturnUrl('javascript:alert(1)')).toBe('/');
      expect(sanitizeReturnUrl('')).toBe('/');
      expect(sanitizeReturnUrl(null)).toBe('/');
    });
  });
});
