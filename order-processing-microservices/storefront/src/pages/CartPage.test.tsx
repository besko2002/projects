import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../api/client';
import * as productsApi from '../api/productsApi';
import { cartValue, productFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { CartPage } from './CartPage';

vi.mock('../api/productsApi', () => ({
  getProduct: vi.fn(),
}));

const getProduct = vi.mocked(productsApi.getProduct);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CartPage', () => {
  it('blocks checkout when a quantity exceeds the live stock', async () => {
    getProduct.mockResolvedValue(productFixture({ availableQuantity: 1 }));
    const cart = cartValue({
      lines: [{ productId: 'product-1', quantity: 3 }],
      totalQuantity: 3,
    });

    renderWithProviders(<CartPage />, { cart });

    expect(await screen.findByText(/Only 1 in stock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
  });

  it('flags a product that disappeared from the catalog', async () => {
    getProduct.mockRejectedValue(
      new ApiException({ status: 404, error: 'Not Found', message: 'Product not found' }),
    );
    const cart = cartValue({
      lines: [{ productId: 'gone', quantity: 1 }],
      totalQuantity: 1,
    });

    renderWithProviders(<CartPage />, { cart });

    expect(await screen.findByText('Unavailable product')).toBeInTheDocument();
    expect(screen.getByText(/no longer in the catalog/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
  });

  it('prices lines from the server in cents and lets the quantity change', async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(productFixture({ price: '24.50', availableQuantity: 5 }));
    const cart = cartValue({
      lines: [{ productId: 'product-1', quantity: 2 }],
      totalQuantity: 2,
    });

    renderWithProviders(<CartPage />, { cart });

    expect(await screen.findByText('Desk Lamp')).toBeInTheDocument();
    // The line total and the estimated total are both 2 × €24.50 = €49.00.
    expect(screen.getAllByText(/49\.00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Increase quantity of Desk Lamp' }));
    expect(cart.setQuantity).toHaveBeenCalledWith('product-1', 3);
  });

  it('does not fetch anything for an empty cart', () => {
    renderWithProviders(<CartPage />);

    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
    expect(getProduct).not.toHaveBeenCalled();
  });
});
