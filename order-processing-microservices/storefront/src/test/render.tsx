import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { AuthContext, type AuthContextValue } from '../state/auth';
import { CartContext, type CartContextValue } from '../state/cart';
import { authValue, cartValue } from './factories';

export interface RenderOptions {
  auth?: AuthContextValue;
  cart?: CartContextValue;
  /** Initial history entry, so tests can exercise query parameters and deep links. */
  route?: string;
}

/**
 * Renders a page inside the two contexts it may need and a router. Pages are tested with plain
 * context values rather than the real providers so each test controls identity and cart state;
 * the providers themselves have their own tests.
 */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const { auth = authValue(), cart = cartValue(), route = '/' } = options;
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={auth}>
        <CartContext.Provider value={cart}>{ui}</CartContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return { ...view, auth, cart };
}
