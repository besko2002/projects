import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrderResponse, PageResponse } from '../types/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../api/client';
import * as ordersApi from '../api/ordersApi';
import { orderFixture, pageFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { OrdersPage } from './OrdersPage';

vi.mock('../api/ordersApi', () => ({
  listMyOrders: vi.fn(),
}));

const listMyOrders = vi.mocked(ordersApi.listMyOrders);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrdersPage', () => {
  it('shows a loading state, then the orders table', async () => {
    const request = deferred<PageResponse<OrderResponse>>();
    listMyOrders.mockReturnValue(request.promise);

    renderWithProviders(<OrdersPage />);
    expect(screen.getByText('Loading your orders…')).toBeInTheDocument();

    await act(async () => {
      request.resolve(pageFixture([orderFixture()]));
    });

    expect(await screen.findByText('ORD-1001')).toBeInTheDocument();
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toBeInTheDocument();
    expect(listMyOrders).toHaveBeenCalledWith(0);
  });

  it('shows the empty state when the customer has no orders', async () => {
    listMyOrders.mockResolvedValue(pageFixture([]));

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText('No orders yet.')).toBeInTheDocument();
  });

  it('shows an error with a working retry', async () => {
    const user = userEvent.setup();
    listMyOrders.mockRejectedValueOnce(
      new ApiException({
        status: 500,
        error: 'Internal Server Error',
        message: 'The store is temporarily unavailable. Please try again.',
      }),
    );
    listMyOrders.mockResolvedValue(pageFixture([orderFixture()]));

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('ORD-1001')).toBeInTheDocument();
    expect(listMyOrders).toHaveBeenCalledTimes(2);
  });

  it('pages through the orders', async () => {
    const user = userEvent.setup();
    listMyOrders
      .mockResolvedValueOnce(
        pageFixture([orderFixture({ id: 'order-1', orderNumber: 'ORD-1' })], {
          page: 0,
          totalPages: 2,
          totalElements: 25,
          last: false,
        }),
      )
      .mockResolvedValueOnce(
        pageFixture([orderFixture({ id: 'order-2', orderNumber: 'ORD-2' })], {
          page: 1,
          totalPages: 2,
          totalElements: 25,
          last: true,
        }),
      );

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText('ORD-1')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('ORD-2')).toBeInTheDocument();
    expect(listMyOrders).toHaveBeenLastCalledWith(1);
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
  });
});
