import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { getProduct } from '../api/productsApi';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { MAX_LINE_QUANTITY, useCart } from '../state/cart';
import type { ProductResponse } from '../types/api';
import { formatMoney } from '../utils/money';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { addLine } = useCart();

  const [product, setProduct] = useState<ProductResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [quantityText, setQuantityText] = useState('1');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setAddedMessage(null);
    getProduct(id)
      .then((result) => {
        if (!cancelled) {
          setProduct(result);
          setQuantityText('1');
          setQuantityError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiException && err.status === 404) {
          setNotFound(true);
        } else {
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading && !product && !notFound) {
    return <Loading label="Loading product…" />;
  }

  if (notFound) {
    return (
      <EmptyState title="Product not found">
        <p className="muted">It may have been removed from the catalog.</p>
        <p>
          <Link className="btn" to="/">
            Back to the catalog
          </Link>
        </p>
      </EmptyState>
    );
  }

  if (error) {
    return <ErrorNotice message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  if (!product) {
    return null;
  }

  const inStock = product.availableQuantity > 0;
  const maxSelectable = Math.min(product.availableQuantity, MAX_LINE_QUANTITY);

  const addToCart = (event: FormEvent) => {
    event.preventDefault();
    setAddedMessage(null);
    const parsed = Number(quantityText);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setQuantityError('Enter a whole number of at least 1.');
      return;
    }
    if (parsed > maxSelectable) {
      setQuantityError(
        product.availableQuantity > MAX_LINE_QUANTITY
          ? `You can add at most ${MAX_LINE_QUANTITY} per order.`
          : `Only ${product.availableQuantity} in stock.`,
      );
      return;
    }
    setQuantityError(null);
    addLine(product.id, parsed);
    setAddedMessage(`Added ${parsed} × ${product.name} to your cart.`);
  };

  return (
    <>
      <div className="page-header">
        <p className="muted">
          <Link to="/">Catalog</Link> / {product.name}
        </p>
        <h1>{product.name}</h1>
        <p className="page-lede mono">{product.sku}</p>
      </div>

      <div className="detail-grid">
        <div className="card">
          <div className="product-card__placeholder" aria-hidden="true" />
          <div style={{ padding: 'var(--space-4)' }}>
            <h2>About this product</h2>
            <p className={product.description ? undefined : 'muted'}>
              {product.description || 'No description was provided for this product.'}
            </p>
          </div>
        </div>

        <div className="stack">
          <p className="product-card__price" style={{ fontSize: '28px' }}>
            {formatMoney(product.price)}
          </p>
          <p>
            <span className={`badge ${inStock ? 'badge--confirmed' : 'badge--rejected'}`}>
              {inStock ? `${product.availableQuantity} in stock` : 'Out of stock'}
            </span>
          </p>

          {inStock ? (
            <form className="form-panel stack" onSubmit={addToCart}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="quantity">Quantity</label>
                <input
                  id="quantity"
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxSelectable}
                  step={1}
                  value={quantityText}
                  onChange={(event) => {
                    setQuantityText(event.target.value);
                    setQuantityError(null);
                  }}
                  aria-invalid={quantityError ? 'true' : undefined}
                  aria-describedby={quantityError ? 'quantity-error' : 'quantity-hint'}
                />
                <span className="field__hint" id="quantity-hint">
                  At most {maxSelectable} per order while this stock lasts.
                </span>
                {quantityError && (
                  <span className="field__error" id="quantity-error">
                    {quantityError}
                  </span>
                )}
              </div>
              <button type="submit" className="btn btn--primary">
                Add to cart
              </button>
              <div role="status" aria-live="polite">
                {addedMessage && (
                  <p className="alert alert--success" style={{ marginBottom: 0 }}>
                    {addedMessage} <Link to="/cart">View cart</Link>
                  </p>
                )}
              </div>
            </form>
          ) : (
            <div className="alert alert--warning" role="status">
              <span>
                This product is out of stock. Stock is rechecked when the order is placed, so it may
                return later.
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
