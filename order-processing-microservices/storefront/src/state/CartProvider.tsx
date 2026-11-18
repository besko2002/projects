import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { clearAttempt } from '../lib/idempotency';
import { CartContext, MAX_LINE_QUANTITY, type CartLine } from './cart';
import { useAuth } from './auth';

const CART_KEY = 'outline_store_cart';

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  const truncated = Math.trunc(quantity);
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, truncated));
}

/**
 * Reads the persisted cart, merging duplicate ids and dropping anything malformed. A corrupt
 * record is a lost cart, not a broken store — the catalog is the source of truth anyway, so the
 * customer can simply add the items again.
 */
function loadCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const merged = new Map<string, number>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const { productId, quantity } = entry as Partial<CartLine>;
      if (typeof productId !== 'string' || productId.length === 0) continue;
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) continue;
      merged.set(productId, clampQuantity((merged.get(productId) ?? 0) + quantity));
    }
    return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  } catch {
    return [];
  }
}

function saveCart(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory cart still works.
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { identityEpoch } = useAuth();
  const [lines, setLines] = useState<CartLine[]>(loadCart);

  useEffect(() => {
    saveCart(lines);
  }, [lines]);

  // A different (or departed) account must not inherit the previous customer's purchase state:
  // both the cart and an unresolved checkout attempt belong to the visit, not to the browser.
useEffect(() => {
    // Only clear cart/attempt when identityEpoch actually changes (i.e. user truly changed).
    // This prevents clearing on re-mounts within the same session.
    const hasIdentityChanged = identityEpoch > 0;
    if (hasIdentityChanged) {
      setLines([]);
      clearAttempt();
    }
  }, [identityEpoch]);

  const addLine = useCallback((productId: string, quantity: number) => {
    if (!productId || !Number.isFinite(quantity)) return;
    setLines((current) => {
      const existing = current.find((line) => line.productId === productId);
      if (!existing) {
        return [...current, { productId, quantity: clampQuantity(quantity) }];
      }
      return current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: clampQuantity(line.quantity + Math.trunc(quantity)) }
          : line,
      );
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    if (!productId || !Number.isFinite(quantity)) return;
    setLines((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, quantity: clampQuantity(quantity) } : line,
      ),
    );
  }, []);

  const removeLine = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const totalQuantity = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  const value = useMemo(
    () => ({ lines, addLine, setQuantity, removeLine, clearCart, totalQuantity }),
    [lines, addLine, setQuantity, removeLine, clearCart, totalQuantity],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
