import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../api/client';
import * as ordersApi from '../api/ordersApi';
import { beginAttempt, loadAttempt, saveAttempt } from '../lib/idempotency';
import { cartValue, orderFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { PaymentSuccessPage } from './PaymentSuccessPage';

vi.mock('../api/ordersApi', () => ({
  getOrder: vi.fn(),
}));

const getOrder = vi.mocked(ordersApi.getOrder);

function trackOrder(orderId = 'order-1') {
  const attempt = beginAttempt([{ productId: 'product-1', quantity: 1 }]);
  saveAttempt({ ...attempt, orderId });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentSuccessPage', () => {
  it('does not guess when this browser has no pending order', () => {
    renderWithProviders(<PaymentSuccessPage />);

    expect(
      screen.getByText('We could not find a pending order in this browser.'),
    ).toBeInTheDocument();
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('waits for CONFIRMED, then clears the cart and the attempt', async () => {
    trackOrder();
    getOrder.mockResolvedValue(orderFixture({ status: 'CONFIRMED' }));
    const cart = cartValue();

    renderWithProviders(<PaymentSuccessPage />, { cart });

    expect(await screen.findByText('Payment confirmed')).toBeInTheDocument();
    expect(cart.clearCart).toHaveBeenCalled();
    expect(loadAttempt()).toBeNull();
  });

  it('reports CANCELLED with the real failure reason', async () => {
    trackOrder();
    getOrder.mockResolvedValue(
      orderFixture({ status: 'CANCELLED', failureReason: 'Payment failed: card declined' }),
    );

    renderWithProviders(<PaymentSuccessPage />);

    expect(await screen.findByText('The order was not completed')).toBeInTheDocument();
    expect(screen.getByText(/card declined/)).toBeInTheDocument();
    expect(loadAttempt()).toBeNull();
  });

  it('keeps the attempt after a timeout and retries on demand', async () => {
    trackOrder('order-9');
    getOrder.mockResolvedValue(orderFixture({ id: 'order-9', status: 'PAYMENT_PENDING' }));

    vi.useFakeTimers();
    try {
      renderWithProviders(<PaymentSuccessPage />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(screen.getByText(/Confirmation is taking longer than usual/)).toBeInTheDocument();
      expect(loadAttempt()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }

    getOrder.mockResolvedValue(orderFixture({ id: 'order-9', status: 'CONFIRMED' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('Payment confirmed')).toBeInTheDocument();
    expect(loadAttempt()).toBeNull();
  });

  it('clears an unrecoverable attempt when the order cannot be read', async () => {
    trackOrder();
    getOrder.mockRejectedValue(
      new ApiException({ status: 404, error: 'Not Found', message: 'Order not found' }),
    );

    renderWithProviders(<PaymentSuccessPage />);

    expect(await screen.findByText(/We could not confirm the payment/)).toBeInTheDocument();
    expect(loadAttempt()).toBeNull();
  });
});
