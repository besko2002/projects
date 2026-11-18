import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../api/client';
import * as ordersApi from '../api/ordersApi';
import { beginAttempt, loadAttempt, saveAttempt } from '../lib/idempotency';
import { cartValue, orderFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { browser } from '../utils/url';
import { CheckoutPage } from './CheckoutPage';

vi.mock('../api/ordersApi', () => ({
  createOrder: vi.fn(),
  getOrder: vi.fn(),
}));

const createOrder = vi.mocked(ordersApi.createOrder);
const getOrder = vi.mocked(ordersApi.getOrder);

const TWO_LAMPS = { productId: 'product-1', quantity: 2 };

function renderCheckout() {
  const cart = cartValue({
    lines: [TWO_LAMPS],
    totalQuantity: TWO_LAMPS.quantity,
  });
  return { ...renderWithProviders(<CheckoutPage />, { cart }), cart };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CheckoutPage', () => {
  it('posts once with a persisted key and follows a safe payment URL', async () => {
    const redirect = vi.spyOn(browser, 'redirect').mockImplementation(() => {});
    createOrder.mockResolvedValue(
      orderFixture({
        status: 'PAYMENT_PENDING',
        paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      }),
    );

    renderCheckout();

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    const [payload, key] = createOrder.mock.calls[0];
    expect(payload).toEqual({ items: [TWO_LAMPS] });
    expect(key).toBeTruthy();

    // The key and the created order id are on disk, so a reload can recover this purchase.
    await waitFor(() => expect(loadAttempt()?.orderId).toBe('order-1'));
    expect(loadAttempt()?.key).toBe(key);

    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'),
    );
    expect(await screen.findByText(/Redirecting to Stripe Checkout/)).toBeInTheDocument();
  });

  it('reuses the same key and payload when a retryable failure is retried', async () => {
    const user = userEvent.setup();
    const { cart } = renderCheckoutWith(() => {
      createOrder.mockRejectedValueOnce(
        new ApiException({
          status: 503,
          error: 'Service Unavailable',
          message: 'The store is temporarily unavailable. Please try again.',
        }),
      );
      createOrder.mockResolvedValue(orderFixture({ status: 'CONFIRMED' }));
    });

    expect(await screen.findByText(/Checkout could not continue/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][1]).toBe(createOrder.mock.calls[0][1]);
    expect(createOrder.mock.calls[1][0]).toEqual(createOrder.mock.calls[0][0]);

    expect(await screen.findByText('Order confirmed')).toBeInTheDocument();
    expect(cart.clearCart).toHaveBeenCalled();
    expect(loadAttempt()).toBeNull();
  });

  it('recovers the tracked order after a reload without posting again', async () => {
    const attempt = beginAttempt([TWO_LAMPS]);
    saveAttempt({ ...attempt, orderId: 'order-77' });
    getOrder.mockResolvedValue(orderFixture({ id: 'order-77', status: 'CONFIRMED' }));

    renderCheckout();

    expect(await screen.findByText('Order confirmed')).toBeInTheDocument();
    expect(createOrder).not.toHaveBeenCalled();
    expect(getOrder).toHaveBeenCalledWith('order-77');
    expect(loadAttempt()).toBeNull();
  });

  it('asks before touching a stored attempt for a different cart, then resumes it', async () => {
    const user = userEvent.setup();
    const stored = beginAttempt([{ productId: 'old-product', quantity: 1 }]);
    const cart = cartValue({
      lines: [{ productId: 'new-product', quantity: 1 }],
      totalQuantity: 1,
    });

    renderWithProviders(<CheckoutPage />, { cart });

    expect(await screen.findByText('An unfinished checkout is stored')).toBeInTheDocument();
    expect(screen.getByText(/different cart/)).toBeInTheDocument();
    expect(createOrder).not.toHaveBeenCalled();

    createOrder.mockResolvedValue(orderFixture({ status: 'CONFIRMED' }));
    await user.click(screen.getByRole('button', { name: 'Resume unfinished checkout' }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(createOrder.mock.calls[0][1]).toBe(stored.key);
    expect(createOrder.mock.calls[0][0]).toEqual({
      items: [{ productId: 'old-product', quantity: 1 }],
    });
  });

  it('refuses to follow an untrusted payment URL', async () => {
    const redirect = vi.spyOn(browser, 'redirect').mockImplementation(() => {});
    createOrder.mockResolvedValue(
      orderFixture({ status: 'PAYMENT_PENDING', paymentUrl: 'javascript:alert(1)' }),
    );

    renderCheckout();

    expect(await screen.findByText(/The payment link was not trusted/)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('stops on a definitive refusal and clears the attempt (out of stock)', async () => {
    createOrder.mockRejectedValue(
      new ApiException({
        status: 409,
        error: 'Conflict',
        message: 'Insufficient stock for Desk Lamp',
      }),
    );

    renderCheckout();

    expect(await screen.findByText(/The order could not be completed/)).toBeInTheDocument();
    expect(screen.getByText(/Insufficient stock/)).toBeInTheDocument();
    expect(loadAttempt()).toBeNull();
  });

  it('surfaces a cancelled order failure reason and clears the attempt', async () => {
    createOrder.mockResolvedValue(
      orderFixture({ status: 'CANCELLED', failureReason: 'Payment failed: card declined' }),
    );

    renderCheckout();

    expect(await screen.findByText(/The order could not be completed/)).toBeInTheDocument();
    expect(screen.getByText(/card declined/)).toBeInTheDocument();
    expect(loadAttempt()).toBeNull();
  });

  it('shows a recoverable timeout instead of inventing a result', async () => {
    vi.useFakeTimers();
    try {
      createOrder.mockResolvedValue(orderFixture({ status: 'STOCK_RESERVED' }));
      getOrder.mockResolvedValue(orderFixture({ status: 'STOCK_RESERVED' }));

      renderCheckout();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(screen.getByText(/This is taking longer than usual/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
      expect(loadAttempt()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Renders checkout after arranging the order API mocks, so each test reads top to bottom. */
function renderCheckoutWith(arrange: () => void) {
  arrange();
  return renderCheckout();
}
