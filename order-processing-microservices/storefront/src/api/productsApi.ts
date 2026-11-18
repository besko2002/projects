import type { PageResponse, ProductResponse } from '../types/api';
import { request } from './client';

export interface ProductQuery {
  page?: number;
  size?: number;
  q?: string;
}

/** GET /api/products?page&size&q — public; `q` searches name and SKU case-insensitively. */
export function listProducts(query: ProductQuery = {}): Promise<PageResponse<ProductResponse>> {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 12));
  const q = query.q?.trim();
  if (q) params.set('q', q);
  return request<PageResponse<ProductResponse>>(`/api/products?${params.toString()}`);
}

/** GET /api/products/{id} — public. */
export function getProduct(id: string): Promise<ProductResponse> {
  return request<ProductResponse>(`/api/products/${encodeURIComponent(id)}`);
}
