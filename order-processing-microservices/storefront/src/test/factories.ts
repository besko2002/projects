import { vi, type Mock } from 'vitest';
import type { AuthContextValue } from '../state/auth';
import type { CartContextValue } from '../state/cart';
import type {
  OrderResponse,
  PageResponse,
  PaymentResponse,
  ProductResponse,
  UserResponse,
} from '../types/api';

export const userFixture: UserResponse = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  role: 'USER',
};

type AuthMocks = AuthContextValue & {
  signIn: Mock<AuthContextValue['signIn']>;
  register: Mock<AuthContextValue['register']>;
  signOut: Mock<AuthContextValue['signOut']>;
};

type AuthOverrides = Partial<Omit<AuthContextValue, 'signIn' | 'register' | 'signOut'>>;

export function authValue(overrides: AuthOverrides = {}): AuthMocks {
  const base = {
    user: userFixture,
    restoring: false,
    identityEpoch: 0,
    signIn: vi.fn<AuthContextValue['signIn']>(async () => userFixture),
    register: vi.fn<AuthContextValue['register']>(async () => userFixture),
    signOut: vi.fn<AuthContextValue['signOut']>(),
  };
  return { ...base, ...overrides };
}

export function cartValue(overrides: Partial<CartContextValue> = {}): CartContextValue {
  return {
    lines: [],
    addLine: vi.fn(),
    setQuantity: vi.fn(),
    removeLine: vi.fn(),
    clearCart: vi.fn(),
    totalQuantity: 0,
    ...overrides,
  };
}

export function productFixture(overrides: Partial<ProductResponse> = {}): ProductResponse {
  return {
    id: 'product-1',
    sku: 'LMP-001',
    name: 'Desk Lamp',
    description: 'A flat-outlined desk lamp.',
    price: '24.50',
    availableQuantity: 5,
    ...overrides,
  };
}

export function orderFixture(overrides: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: 'order-1',
    orderNumber: 'ORD-1001',
    userId: userFixture.id,
    status: 'PAYMENT_PENDING',
    totalAmount: '49.00',
    currency: 'EUR',
    refundStatus: 'NONE',
    createdAt: '2026-11-17T10:00:00Z',
    updatedAt: '2026-11-17T10:00:00Z',
    items: [
      {
        productId: 'product-1',
        productName: 'Desk Lamp',
        unitPrice: '24.50',
        quantity: 2,
        lineTotal: '49.00',
      },
    ],
    ...overrides,
  };
}

export function paymentFixture(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return {
    id: 'payment-1',
    orderId: 'order-1',
    customerId: userFixture.id,
    amount: '49.00',
    currency: 'EUR',
    status: 'AWAITING_CUSTOMER',
    simulated: false,
    createdAt: '2026-11-17T10:00:00Z',
    updatedAt: '2026-11-17T10:00:00Z',
    ...overrides,
  };
}

export function pageFixture<T>(
  content: T[],
  overrides: Partial<PageResponse<T>> = {},
): PageResponse<T> {
  return {
    content,
    page: 0,
    size: 20,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
    last: true,
    ...overrides,
  };
}
