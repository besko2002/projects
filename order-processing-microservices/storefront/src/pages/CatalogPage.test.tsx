import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../api/client';
import * as productsApi from '../api/productsApi';
import type { PageResponse, ProductResponse } from '../types/api';
import { pageFixture, productFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { CatalogPage } from './CatalogPage';

vi.mock('../api/productsApi', () => ({
  listProducts: vi.fn(),
}));

const listProducts = vi.mocked(productsApi.listProducts);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CatalogPage', () => {
  it('shows a loading state, then the product grid', async () => {
    const request = deferred<PageResponse<ProductResponse>>();
    listProducts.mockReturnValue(request.promise);

    renderWithProviders(<CatalogPage />);
    expect(screen.getByText('Loading products…')).toBeInTheDocument();

    await act(async () => {
      request.resolve(pageFixture([productFixture()]));
    });

    expect(await screen.findByText('Desk Lamp')).toBeInTheDocument();
    expect(screen.getByText('5 in stock')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Desk Lamp/ })).toHaveAttribute(
      'href',
      '/products/product-1',
    );
    expect(listProducts).toHaveBeenCalledWith({ page: 0, size: 12, q: '' });
  });

  it('shows the empty state for a search with no matches', async () => {
    listProducts.mockResolvedValue(pageFixture([]));

    renderWithProviders(<CatalogPage />, { route: '/?q=nothing' });

    expect(await screen.findByText('No products match your search.')).toBeInTheDocument();
    expect(listProducts).toHaveBeenCalledWith({ page: 0, size: 12, q: 'nothing' });
  });

  it('shows an error with a working retry', async () => {
    const user = userEvent.setup();
    listProducts.mockRejectedValueOnce(
      new ApiException({
        status: 500,
        error: 'Internal Server Error',
        message: 'The store is temporarily unavailable. Please try again.',
      }),
    );
    listProducts.mockResolvedValue(pageFixture([productFixture()]));

    renderWithProviders(<CatalogPage />);

    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Desk Lamp')).toBeInTheDocument();
  });

  it('puts the search term in the URL and refetches', async () => {
    const user = userEvent.setup();
    listProducts.mockResolvedValue(pageFixture([productFixture()]));

    renderWithProviders(<CatalogPage />);
    await screen.findByText('Desk Lamp');

    await user.type(screen.getByLabelText('Search by name or SKU'), 'lamp');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(listProducts).toHaveBeenLastCalledWith({ page: 0, size: 12, q: 'lamp' }),
    );
  });

  it('pages through the catalog', async () => {
    const user = userEvent.setup();
    listProducts
      .mockResolvedValueOnce(
        pageFixture([productFixture()], {
          page: 0,
          totalPages: 2,
          totalElements: 20,
          last: false,
        }),
      )
      .mockResolvedValueOnce(
        pageFixture([productFixture({ id: 'product-2', name: 'Floor Lamp' })], {
          page: 1,
          totalPages: 2,
          totalElements: 20,
          last: true,
        }),
      );

    renderWithProviders(<CatalogPage />);

    expect(await screen.findByText('Desk Lamp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Floor Lamp')).toBeInTheDocument();
    expect(listProducts).toHaveBeenLastCalledWith({ page: 1, size: 12, q: '' });
  });
});
