import type {
  CreateOrderRequest,
  OrderEventResponse,
  OrderResponse,
  PageResponse,
} from '../types/api';
import { request } from './client';

/**
 * POST /api/orders with an Idempotency-Key. The same key with the same items replays the
 * existing order (200) instead of creating a second one; the same key with different items is 409.
 */
export function createOrder(body: CreateOrderRequest, idempotencyKey: string): Promise<OrderResponse> {
  return request<OrderResponse>('/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
}

/** GET /api/orders/{id} — owner or ADMIN; anybody else gets 404. */
export function getOrder(id: string): Promise<OrderResponse> {
  return request<OrderResponse>(`/api/orders/${encodeURIComponent(id)}`);
}

/** GET /api/orders/me?page&size — the caller's own orders, newest first. */
export function listMyOrders(page = 0, size = 20): Promise<PageResponse<OrderResponse>> {
  return request<PageResponse<OrderResponse>>(`/api/orders/me?page=${page}&size=${size}`);
}

/** POST /api/orders/{id}/cancel — answers the order as it stands after cancellation started. */
export function cancelOrder(id: string): Promise<OrderResponse> {
  return request<OrderResponse>(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

/** GET /api/orders/{id}/events — the events and commands order-service recorded for the order. */
export function listOrderEvents(id: string): Promise<OrderEventResponse[]> {
  return request<OrderEventResponse[]>(`/api/orders/${encodeURIComponent(id)}/events`);
}
