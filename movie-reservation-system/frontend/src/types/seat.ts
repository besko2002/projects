export type SeatType = 'NORMAL' | 'VIP';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED';

export interface SeatDto {
  seatId: number;
  rowLabel: string;
  seatNumber: number;
  type: SeatType;
  price: number;
  status: SeatStatus;
}

export interface SeatMapDto {
  scheduleId: number;
  theaterId: number;
  startTime: string;
  seats: SeatDto[];
}

export interface HoldRequest {
  scheduleId: number;
  seatIds: number[];
}

export interface HeldSeatItemDto {
  reservationId: number;
  seatId: number;
  rowLabel: string;
  seatNumber: number;
  type: SeatType;
  price: number;
}

export interface HoldResponse {
  reservationIds: number[];
  scheduleId: number;
  seats: HeldSeatItemDto[];
  totalPrice: number;
  expiresAt: string;
}

export interface SeatReservationDto {
  id: number;
  scheduleId: number;
  seatId: number;
  ticketId: number | null;
  price: number;
  status: 'HELD' | 'CONFIRMED' | 'RELEASED';
  expiresAt: string;
}
