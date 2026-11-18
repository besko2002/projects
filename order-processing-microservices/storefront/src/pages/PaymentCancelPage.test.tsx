import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ordersApi from '../api/ordersApi';
import { beginAttempt, loadAttempt, saveAttempt } from '../lib/idempotency';
import { orderFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { browser } from '../utils/url';
import { PaymentCancelPage } from './PaymentCancelPage';

vi.mock('../api/ordersApi', () => ({
  getOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));

const getOrder = vi.mocked(ordersApi.getOrder);
const cancelOrder = vi.mocked(ordersApi.cancelOrder);

function trackOrder(orderId = 'order-1') {
  const attempt = beginAttempt([{ productId: 'product-1', quantity: 1 }]);
  saveAttempt({ ...attempt, orderId });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentCancelPage', () => {
  it('says plainly that leaving Stripe did not cancel anything', () => {
    renderWithProviders(<PaymentCancelPage />);

    expect(
      screen.getByText('Returning from Stripe does not cancel your order.'),
    ).toBeInTheDocument();
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('lets the customer pay the still-open session', async () => {
    const user = userEvent.setup();
    const redirect = vi.spyOn(browser, 'redirect').mockImplementation(() => {});
    trackOrder();
    getOrder.mockResolvedValue(
      orderFixture({
        status: 'PAYMENT_PENDING',
        paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_open',
      }),
    );

    renderWithProviders(<PaymentCancelPage />);

    await user.click(await screen.findByRole('button', { name: 'Pay now' }));

    expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_open');
    expect(loadAttempt()).not.toBeNull();
  });

  it('cancels only on an explicit action and reports the refund as requested', async () => {
    const user = userEvent.setup();
    trackOrder();
    getOrder.mockResolvedValue(orderFixture({ status: 'PAYMENT_PENDING' }));
    cancelOrder.mockResolvedValue(
      orderFixture({ status: 'CANCELLATION_PENDING', refundStatus: 'REQUESTED' }),
    );

    renderWithProviders(<PaymentCancelPage />);
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));

    expect(await screen.findByText(/Cancellation started/)).toBeInTheDocument();
    expect(screen.getByText('Refund requested')).toBeInTheDocument();
    expect(screen.getByText(/returned only when the payment provider settles it/)).toBeInTheDocument();
    expect(loadAttempt()).toBeNull();
  });

  it('reports a payment that actually went through despite the cancel redirect', async () => {
    trackOrder();
    getOrder.mockResolvedValue(orderFixture({ status: 'CONFIRMED' }));

    renderWithProviders(<PaymentCancelPage />);

    expect(await screen.findByText('Your payment went through.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('distinguishes a settled refund from a pending one', async () => {
    trackOrder();
    getOrder.mockResolvedValue(
      orderFixture({ status: 'CANCELLED', refundStatus: 'REFUNDED' }),
    );

    renderWithProviders(<PaymentCancelPage />);

    expect(
      await screen.findByText(/The refund has been settled by the payment provider/),
    ).toBeInTheDocument();
    expect(screen.getByText('Refund settled')).toBeInTheDocument();
  });
});
