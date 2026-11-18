import type { PaymentResponse } from '../types/api';
import { ApiException, request } from './client';

/**
 * GET /api/payments/order/{orderId}. Used only to tell the customer whether money was refunded,
 * because OrderResponse does not expose the order's refund status. Resolves to null when no payment
 * exists for the order (404) — e.g. it was rejected before payment was attempted.
 */
export async function getPaymentForOrder(orderId: string): Promise<PaymentResponse | null> {
  try {
    return await request<PaymentResponse>(`/api/payments/order/${encodeURIComponent(orderId)}`);
  } catch (err) {
    if (err instanceof ApiException && err.status === 404) return null;
    throw err;
  }
}
