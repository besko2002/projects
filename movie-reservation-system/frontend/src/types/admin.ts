export interface TheaterSummary {
  id: number;
  name: string;
  location?: string | null;
  totalRows: number;
  seatsPerRow: number;
  totalSeats: number;
}

export interface TheaterDto extends TheaterSummary {
  vipRows: string[];
}

export interface CreateTheaterPayload {
  name: string;
  location?: string | null;
  totalRows: number;
  seatsPerRow: number;
  vipRows?: string[];
}

export interface CreateMoviePayload {
  title: string;
  description?: string | null;
  posterUrl?: string | null;
  durationMinutes: number;
  releaseDate?: string | null;
  genreIds: number[];
}

export interface UpdateMoviePayload {
  title: string;
  description?: string | null;
  posterUrl?: string | null;
  durationMinutes: number;
  releaseDate?: string | null;
  genreIds: number[];
}

export interface CreateSchedulePayload {
  movieId: number;
  theaterId: number;
  startTime: string;
  basePrice: number;
  vipPrice: number;
}

export interface RevenueReport {
  from: string;
  to: string;
  currency: string;
  paidTickets: number;
  grossRevenue: number;
  refundedTickets: number;
  refundedAmount: number;
  netRevenue: number;
  byMovie?: Array<{
    movieId: number;
    title?: string;
    movieTitle?: string;
    tickets?: number;
    paidTickets?: number;
    revenue?: number;
    grossRevenue?: number;
  }>;
  byDay?: Array<{
    date: string;
    tickets?: number;
    paidTickets?: number;
    revenue?: number;
    grossRevenue?: number;
  }>;
}

export interface OccupancyReport {
  scheduleId: number;
  movieTitle: string;
  theaterName: string;
  startTime: string;
  capacity: number;
  bookedSeats: number;
  heldSeats: number;
  availableSeats: number;
  occupancyPercent: number;
  revenue: number;
}

export interface AdminTicketSeat {
  seatId: number;
  rowLabel: string;
  seatNumber: number;
  seatType: 'NORMAL' | 'VIP';
  price: number;
}

export interface AdminTicket {
  id: number;
  userId: number;
  scheduleId: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED';
  totalPrice: number;
  currency: string;
  createdAt: string;
  paidAt?: string | null;
  cancelledAt?: string | null;
  movieTitle?: string;
  theaterName?: string;
  startTime?: string;
  seats?: AdminTicketSeat[];
}
