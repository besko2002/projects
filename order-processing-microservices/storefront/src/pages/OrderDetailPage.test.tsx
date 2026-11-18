import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../api/client';
import * as ordersApi from '../api/ordersApi';
import * as paymentsApi from '../api/paymentsApi';
import { orderFixture, paymentFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { OrderDetailPage } from './OrderDetailPage';

vi.mock('../api/ordersApi', () => ({
  getOrder: vi.fn(),
  listOrderEvents: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock('../api/paymentsApi', () => ({
  getPaymentForOrder: vi.fn(),
}));

const getOrder = vi.mocked(ordersApi.getOrder);
const listOrderEvents = vi.mocked(ordersApi.listOrderEvents);
const cancelOrder = vi.mocked(ordersApi.cancelOrder);
const getPaymentForOrder = vi.mocked(paymentsApi.getPaymentForOrder);

function renderOrderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/orders/:id" element={<OrderDetailPage />} />
    </Routes>,
    { route: '/orders/order-1' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrderDetailPage', () => {
  it('renders server totals, the recorded timeline and a settled refund', async () => {
    getOrder.mockResolvedValue(orderFixture({ status: 'CONFIRMED', refundStatus: 'REFUNDED' }));
    getPaymentForOrder.mockResolvedValue(paymentFixture({ status: 'REFUNDED' }));
    listOrderEvents.mockResolvedValue([
      {
        eventType: 'ProcessPayment',
        topic: 'orders.commands',
        createdAt: '2026-11-17T10:00:05Z',
        publishedAt: '2026-11-17T10:00:06Z',
        attempts: 0,
      },
      {
        eventType: 'OrderConfirmed',
        topic: 'orders.events',
        createdAt: '2026-11-17T10:01:00Z',
        attempts: 0,
      },
    ]);

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Order ORD-1001' })).toBeInTheDocument();
    expect(screen.getAllByText('Refund settled').length).toBeGreaterThan(0);
    expect(
      screen.getByText('The payment provider confirmed the refund.'),
    ).toBeInTheDocument();
    expect(screen.getByText('ProcessPayment')).toBeInTheDocument();
    expect(screen.getByText('OrderConfirmed')).toBeInTheDocument();
    expect(screen.getByText(/orders\.commands/)).toBeInTheDocument();
    expect(screen.getByText(/· published/)).toBeInTheDocument();
    expect(screen.getByText(/· queued/)).toBeInTheDocument();
    expect(getPaymentForOrder).toHaveBeenCalledWith('order-1');
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument();
  });

  it('shows a requested refund as pending and labels a missing timeline honestly', async () => {
    getOrder.mockResolvedValue(
      orderFixture({ status: 'CANCELLATION_PENDING', refundStatus: 'REQUESTED' }),
    );
    getPaymentForOrder.mockResolvedValue(paymentFixture({ status: 'AUTHORIZED' }));
    listOrderEvents.mockResolvedValue([]);

    renderOrderDetail();

    expect(await screen.findByText(/requested but not settled yet/)).toBeInTheDocument();
    expect(screen.getAllByText('Refund requested').length).toBeGreaterThan(0);
    expect(screen.getByText(/Current progress only/)).toBeInTheDocument();
  });

  it('cancels on request and reports the new state without refetching it away', async () => {
    const user = userEvent.setup();
    const cancelled = orderFixture({
      status: 'CANCELLED',
      failureReason: 'Cancelled by customer',
    });
    getOrder.mockResolvedValue(orderFixture({ status: 'PAYMENT_PENDING' }));
    getPaymentForOrder.mockResolvedValue(null);
    listOrderEvents.mockResolvedValue([]);
    cancelOrder.mockResolvedValue(cancelled);

    renderOrderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));

    expect(await screen.findByText('The order is cancelled.')).toBeInTheDocument();
    expect(screen.getByText('Order cancelled')).toBeInTheDocument();
    expect(screen.getByText('Cancelled by customer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('reports an order that is not visible to this account', async () => {
    getOrder.mockRejectedValue(
      new ApiException({ status: 404, error: 'Not Found', message: 'Order not found' }),
    );

    renderOrderDetail();

    expect(await screen.findByText('Order not found')).toBeInTheDocument();
  });
});
