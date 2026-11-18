import { createContext, useContext } from 'react';

export interface CartLine {
  productId: string;
  quantity: number;
}

/** Upper bound per line, mirrored by the cart's clamp; stock limits are revalidated per product. */
export const MAX_LINE_QUANTITY = 99;

export interface CartContextValue {
  lines: CartLine[];
  /** Adds to an existing line, clamping the sum to 1..MAX_LINE_QUANTITY. */
  addLine(productId: string, quantity: number): void;
  /** Replaces a line's quantity, clamped to 1..MAX_LINE_QUANTITY; invalid input is ignored. */
  setQuantity(productId: string, quantity: number): void;
  removeLine(productId: string): void;
  clearCart(): void;
  /** Sum of quantities, for the header badge. */
  totalQuantity: number;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) {
    throw new Error('useCart must be used inside <CartProvider>');
  }
  return value;
}
