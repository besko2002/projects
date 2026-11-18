/**
 * Wire types, copied field-for-field from the backend records. Comments name the source record so a
 * contract change is easy to trace. BigDecimal values arrive as JSON numbers (Jackson default),
 * but they are typed `number | string` and always read through `toAmount` to stay safe if the
 * serialisation ever switches to strings.
 */

export type Money = number | string;

/** service-support / auth-service `ApiError`, and the gateway's own 401/403/429 body. */
export interface ApiError {
  timestamp?: string;
  status: number;
  error: string;
  message: string;
  path?: string;
  fieldErrors?: Record<string, string>;
}

/** inventory-service and order-service `PageResponse<T>`. */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}

/** auth-service `Role`. */
export type Role = 'USER' | 'ADMIN';

/** auth-service `UserResponse`. */
export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** auth-service `AuthResponse` (same shape for register and login). */
export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: UserResponse;
}

/** inventory-service `ProductResponse` (public catalog view). */
export interface ProductResponse {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: Money;
  availableQuantity: number;
}

/** order-service `OrderStatus`. */
export type OrderStatus =
  | 'PENDING'
  | 'STOCK_RESERVED'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'REJECTED';

/** order-service `OrderItemRequest`. */
export interface OrderItemRequest {
  productId: string;
  quantity: number;
}

/** order-service `CreateOrderRequest`. */
export interface CreateOrderRequest {
  items: OrderItemRequest[];
}

/** order-service `OrderItemResponse`. */
export interface OrderItemResponse {
  productId: string;
  productName: string;
  unitPrice: Money;
  quantity: number;
  lineTotal: Money;
}

/**
 * order-service `RefundStatus` — the saga's refund bookkeeping, shown on orders so the customer
 * can tell "cancellation accepted" from "money actually returned".
 */
export type RefundStatus = 'NONE' | 'REQUESTED' | 'REFUNDED';

/**
 * order-service `OrderResponse`. `@JsonInclude(NON_NULL)`: `failureReason` and `paymentUrl` are
 * simply missing when null. `paymentUrl` is present only while the order is STOCK_RESERVED or
 * PAYMENT_PENDING and a hosted checkout is open.
 */
export interface OrderResponse {
  id: string;
  orderNumber: string;
  userId: string;
  status: OrderStatus;
  totalAmount: Money;
  currency: string;
  failureReason?: string;
  paymentUrl?: string;
  refundStatus: RefundStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItemResponse[];
}

/**
 * order-service `OrderEventResponse` — one event or command the saga emitted for an order. This
 * is the real, server-recorded timeline (`GET /api/orders/{id}/events`), not a client-side
 * reconstruction. Payloads are deliberately absent.
 */
export interface OrderEventResponse {
  eventType: string;
  topic: string;
  createdAt: string;
  publishedAt?: string;
  attempts: number;
  traceId?: string;
  correlationId?: string;
}

/** payment-service `PaymentStatus`. */
export type PaymentStatus = 'AWAITING_CUSTOMER' | 'AUTHORIZED' | 'FAILED' | 'REFUNDED';

/** payment-service `PaymentResponse` (`@JsonInclude(NON_NULL)`). */
export interface PaymentResponse {
  id: string;
  orderId: string;
  customerId: string;
  amount: Money;
  currency: string;
  status: PaymentStatus;
  failureReason?: string;
  providerRef?: string;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}
