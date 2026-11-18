import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { getProduct } from '../api/productsApi';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { MAX_LINE_QUANTITY, useCart } from '../state/cart';
import type { ProductResponse } from '../types/api';
import { formatCents, formatMoney, toCents } from '../utils/money';

/**
 * The cart stores product ids and quantities only. Prices and stock are fetched from the catalog
 * on every visit and revalidated by the server when the order is placed — the charged total is
 * always the server's, never this page's estimate.
 */
export function CartPage() {
  const { lines, setQuantity, removeLine } = useCart();
  const navigate = useNavigate();

  const idsKey = lines
    .map((line) => line.productId)
    .sort()
    .join(',');

  const [products, setProducts] = useState<Record<string, ProductResponse | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!idsKey) {
      setProducts({});
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(
      idsKey.split(',').map(async (id) => {
        try {
          return [id, await getProduct(id)] as const;
        } catch (err) {
          if (err instanceof ApiException && err.status === 404) {
            return [id, null] as const; // removed from the catalog
          }
          throw err;
        }
      }),
    )
      .then((entries) => {
        if (!cancelled) setProducts(Object.fromEntries(entries));
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
  }, [idsKey, reloadKey]);

  if (lines.length === 0) {
    return (
      <>
        <div className="page-header">
          <h1>Cart</h1>
        </div>
        <EmptyState title="Your cart is empty.">
          <p className="muted">Browse the catalog and add something to start a checkout.</p>
          <p>
            <Link className="btn btn--primary" to="/">
              Browse the catalog
            </Link>
          </p>
        </EmptyState>
      </>
    );
  }

  const resolved = lines.map((line) => ({
    ...line,
    product: products[line.productId] ?? null,
  }));

  const unavailable = resolved.filter((line) => !line.product);
  const exceedsStock = resolved.filter(
    (line) => line.product && line.quantity > line.product.availableQuantity,
  );
  const showPriceLoading = (loading && Object.keys(products).length === 0) || error !== null;

  const totalCents = resolved.reduce(
    (sum, line) => (line.product ? sum + toCents(line.product.price) * line.quantity : sum),
    0,
  );
  const payable =
    !showPriceLoading &&
    !loading &&
    unavailable.length === 0 &&
    exceedsStock.length === 0 &&
    totalCents > 0;

  return (
    <>
      <div className="page-header">
        <h1>Cart</h1>
        <p className="page-lede">
          Prices and availability are live from the inventory service. The server rechecks both when
          the order is placed and its total is the one that matters.
        </p>
      </div>

      {error && <ErrorNotice message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {loading && Object.keys(products).length === 0 && <Loading label="Checking prices and stock…" />}

      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Cart lines with live prices and quantities</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Unit price</th>
              <th scope="col">Quantity</th>
              <th scope="col">Line total</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((line) => {
              const product = line.product;
              const label = product ? product.name : 'Unavailable product';
              const maxQuantity = product
                ? Math.min(MAX_LINE_QUANTITY, Math.max(1, product.availableQuantity))
                : MAX_LINE_QUANTITY;
              return (
                <tr key={line.productId}>
                  <td>
                    {product ? (
                      <Link to={`/products/${product.id}`}>{product.name}</Link>
                    ) : (
                      <span>
                        <strong>{label}</strong>
                        <br />
                        <span className="muted">This product is no longer in the catalog.</span>
                      </span>
                    )}
                  </td>
                  <td className="table--num">
                    {product ? formatMoney(product.price) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn--small"
                        aria-label={`Decrease quantity of ${label}`}
                        disabled={line.quantity <= 1}
                        onClick={() => setQuantity(line.productId, line.quantity - 1)}
                      >
                        −
                      </button>
                      <input
                        className="input"
                        style={{ width: '72px' }}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={maxQuantity}
                        step={1}
                        aria-label={`Quantity of ${label}`}
                        value={line.quantity}
                        onChange={(event) => {
                          const next = Number.parseInt(event.target.value, 10);
                          if (Number.isInteger(next) && next >= 1) {
                            setQuantity(line.productId, next);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--small"
                        aria-label={`Increase quantity of ${label}`}
                        disabled={line.quantity >= maxQuantity}
                        onClick={() => setQuantity(line.productId, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    {line.quantity > MAX_LINE_QUANTITY && (
                      <span className="field__error">At most {MAX_LINE_QUANTITY} per line.</span>
                    )}
                    {product && line.quantity > product.availableQuantity && (
                      <span className="field__error">
                        Only {product.availableQuantity} in stock — lower the quantity before
                        checkout.
                      </span>
                    )}
                  </td>
                  <td className="table--num">
                    {product ? formatCents(toCents(product.price) * line.quantity) : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => removeLine(line.productId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="order-summary" style={{ marginTop: 'var(--space-5)' }}>
        <div className="order-summary__row">
          <span>Items</span>
          <span>{resolved.reduce((sum, line) => sum + line.quantity, 0)}</span>
        </div>
        <div className="order-summary__row order-summary__total">
          <span>Estimated total</span>
          <span>{formatCents(totalCents)}</span>
        </div>
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
          This is an estimate from current catalog prices. The order service confirms the charged
          amount when the order is placed.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!payable}
            onClick={() => navigate('/checkout')}
          >
            Checkout
          </button>
          <Link className="btn" to="/">
            Continue shopping
          </Link>
        </div>
        {!payable && !showPriceLoading && (
          <p className="field__error" role="status">
            Resolve the stock or availability warnings above before checking out.
          </p>
        )}
      </div>
    </>
  );
}
