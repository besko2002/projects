import type { SeatType } from './seat';

export type TicketStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED';

export interface TicketCheckoutResponse {
  ticketId: number;
  status: TicketStatus;
  totalPrice: number;
  currency: string;
  checkoutUrl: string;
  expiresAt: string;
}

export interface TicketSeatDto {
  rowLabel: string;
  seatNumber: number;
  type: SeatType;
  price: number;
}

export interface TicketDto {
  id: number;
  scheduleId: number;
  movieTitle: string;
  scheduleStartTime: string;
  status: TicketStatus;
  totalPrice: number;
  currency: string;
  seatCount: number;
  seats: TicketSeatDto[];
  paidAt: string | null;
  cancelledAt: string | null;
}
