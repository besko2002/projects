import { request } from './client';
import type { PageResponse } from '../types/api';
import type { TicketCheckoutResponse, TicketDto } from '../types/ticket';

export async function checkoutTicket(scheduleId: number): Promise<TicketCheckoutResponse> {
  return request<TicketCheckoutResponse>('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ scheduleId }),
  });
}

export async function getMyTickets(
  page = 0,
  size = 20,
): Promise<PageResponse<TicketDto>> {
  return request<PageResponse<TicketDto>>(`/api/tickets/me?page=${page}&size=${size}`);
}

export async function getTicket(id: number): Promise<TicketDto> {
  return request<TicketDto>(`/api/tickets/${id}`);
}

export async function cancelTicket(id: number): Promise<void> {
  return request<void>(`/api/tickets/${id}`, {
    method: 'DELETE',
  });
}
