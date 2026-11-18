import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { listProducts } from '../api/productsApi';
import { errorMessage } from '../api/client';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import type { PageResponse, ProductResponse } from '../types/api';
import { formatMoney } from '../utils/money';

const PAGE_SIZE = 12;

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const pageParam = Number.parseInt(params.get('page') ?? '0', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 0;

  const [draft, setDraft] = useState(q);
  const [data, setData] = useState<PageResponse<ProductResponse> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The URL is the source of truth (shareable, back/forward works); keep the input in sync when
  // it changes from outside the form.
  useEffect(() => {
    setDraft(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listProducts({ page, size: PAGE_SIZE, q })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, q, reloadKey]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams();
    const trimmed = draft.trim();
    if (trimmed) next.set('q', trimmed);
    setParams(next);
  };

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(params);
    if (nextPage <= 0) {
      next.delete('page');
    } else {
      next.set('page', String(nextPage));
    }
    setParams(next);
  };

  return (
    <>
      <div className="page-header">
        <h1>Catalog</h1>
        <p className="page-lede">
          Products come live from the inventory service; stock shown here is what the order saga
          will reserve when you check out.
        </p>
      </div>

      <form className="row" onSubmit={submitSearch} role="search">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="catalog-search">Search by name or SKU</label>
          <input
            id="catalog-search"
            className="input"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. lamp"
          />
        </div>
        <button type="submit" className="btn" style={{ alignSelf: 'flex-end' }}>
          Search
        </button>
        {q && (
          <button
            type="button"
            className="btn"
            style={{ alignSelf: 'flex-end' }}
            onClick={() => {
              setDraft('');
              setParams(new URLSearchParams());
            }}
          >
            Clear
          </button>
        )}
      </form>

      <hr className="divider" />

      {error && (
        <ErrorNotice message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      )}

      {loading && !data && <Loading label="Loading products…" />}

      {!loading && !error && data && data.content.length === 0 && (
        <EmptyState title="No products match your search.">
          <p className="muted">Try a different word, or clear the search to see the whole catalog.</p>
        </EmptyState>
      )}

      {data && data.content.length > 0 && (
        <>
          <div className="grid" aria-busy={loading}>
            {data.content.map((product) => (
              <article className="card product-card" key={product.id}>
                <Link to={`/products/${product.id}`}>
                  <div className="product-card__placeholder" aria-hidden="true" />
                  <span className="product-card__name">{product.name}</span>
                  <span className="product-card__price">{formatMoney(product.price)}</span>
                  <span className="product-card__meta mono">{product.sku}</span>
                  <span className="product-card__meta">
                    {product.availableQuantity > 0
                      ? `${product.availableQuantity} in stock`
                      : 'Out of stock'}
                  </span>
                </Link>
              </article>
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            itemLabel="products"
            onChange={goToPage}
          />
        </>
      )}
    </>
  );
}
