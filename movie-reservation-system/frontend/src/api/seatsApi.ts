import { request } from './client';
import type { HoldResponse, SeatMapDto, SeatReservationDto } from '../types/seat';

export async function getSeatMap(scheduleId: number): Promise<SeatMapDto> {
  return request<SeatMapDto>(`/api/schedules/${scheduleId}/seats`);
}

export async function holdSeats(
  scheduleId: number,
  seatIds: number[],
): Promise<HoldResponse> {
  return request<HoldResponse>('/api/seat-reservations', {
    method: 'POST',
    body: JSON.stringify({ scheduleId, seatIds }),
  });
}

export async function getMyReservations(): Promise<SeatReservationDto[]> {
  return request<SeatReservationDto[]>('/api/seat-reservations/me');
}

export async function releaseReservation(id: number): Promise<void> {
  return request<void>(`/api/seat-reservations/${id}`, {
    method: 'DELETE',
  });
}
