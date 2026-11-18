import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { beginAttempt, loadAttempt } from '../lib/idempotency';
import { AuthContext } from '../state/auth';
import { CartProvider } from '../state/CartProvider';
import { useCart } from '../state/cart';
import { authValue } from '../test/factories';

function Probe() {
  const cart = useCart();
  return (
    <div>
      <output data-testid="lines">{JSON.stringify(cart.lines)}</output>
      <output data-testid="total">{cart.totalQuantity}</output>
      <button onClick={() => cart.addLine('p1', 2)}>add-p1-2</button>
      <button onClick={() => cart.addLine('p1', 100)}>add-p1-100</button>
      <button onClick={() => cart.addLine('p2', 3)}>add-p2-3</button>
      <button onClick={() => cart.setQuantity('p1', 0)}>set-p1-0</button>
      <button onClick={() => cart.setQuantity('p1', 150)}>set-p1-150</button>
      <button onClick={() => cart.setQuantity('p2', Number.NaN)}>set-p2-nan</button>
      <button onClick={() => cart.removeLine('p1')}>remove-p1</button>
    </div>
  );
}

function renderCart(identityEpoch = 0) {
  const auth = authValue({ identityEpoch });
  const view = render(
    <AuthContext.Provider value={auth}>
      <CartProvider>
        <Probe />
      </CartProvider>
    </AuthContext.Provider>,
  );
  return { ...view, auth };
}

function lines(view: ReturnType<typeof renderCart>): unknown {
  return JSON.parse(view.getByTestId('lines').textContent ?? 'null');
}

describe('cart state', () => {
  it('adds lines, merges duplicates and reports the total quantity', async () => {
    const user = userEvent.setup();
    const view = renderCart();
    await user.click(view.getByRole('button', { name: 'add-p1-2' }));
    await user.click(view.getByRole('button', { name: 'add-p2-3' }));
    await user.click(view.getByRole('button', { name: 'add-p1-2' }));

    expect(lines(view)).toEqual([
      { productId: 'p1', quantity: 4 },
      { productId: 'p2', quantity: 3 },
    ]);
    expect(view.getByTestId('total')).toHaveTextContent('7');
  });

  it('clamps quantities to the 1..99 boundaries', async () => {
    const user = userEvent.setup();
    const view = renderCart();

    await user.click(view.getByRole('button', { name: 'add-p1-100' }));
    expect(lines(view)).toEqual([{ productId: 'p1', quantity: 99 }]);

    await user.click(view.getByRole('button', { name: 'set-p1-0' }));
    expect(lines(view)).toEqual([{ productId: 'p1', quantity: 1 }]);

    await user.click(view.getByRole('button', { name: 'set-p1-150' }));
    expect(lines(view)).toEqual([{ productId: 'p1', quantity: 99 }]);

    await user.click(view.getByRole('button', { name: 'set-p2-nan' }));
    expect(lines(view)).toEqual([{ productId: 'p1', quantity: 99 }]);
  });

  it('removes lines', async () => {
    const user = userEvent.setup();
    const view = renderCart();
    await user.click(view.getByRole('button', { name: 'add-p1-2' }));
    await user.click(view.getByRole('button', { name: 'add-p2-3' }));
    await user.click(view.getByRole('button', { name: 'remove-p1' }));
    expect(lines(view)).toEqual([{ productId: 'p2', quantity: 3 }]);
  });

  it('persists ids and quantities and restores them on reload', async () => {
    const user = userEvent.setup();
    const first = renderCart();
    await user.click(first.getByRole('button', { name: 'add-p1-2' }));
    await user.click(first.getByRole('button', { name: 'add-p2-3' }));
    first.unmount();

    const second = renderCart();
    expect(lines(second)).toEqual([
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 3 },
    ]);
  });

  it('starts clean from corrupt or malformed storage', () => {
    window.localStorage.setItem('outline_store_cart', '{not json');
    const corrupt = renderCart();
    expect(lines(corrupt)).toEqual([]);
    corrupt.unmount();

    window.localStorage.setItem(
      'outline_store_cart',
      JSON.stringify([
        { productId: 'p1', quantity: 2 },
        { productId: 'p1', quantity: 3 },
        { productId: '', quantity: 1 },
        { productId: 'p2', quantity: 0 },
        { productId: 'p3', quantity: 1.5 },
        'nonsense',
        null,
      ]),
    );
    expect(lines(renderCart())).toEqual([{ productId: 'p1', quantity: 5 }]);
  });

  it('clears the cart and any checkout attempt when the account changes', async () => {
    const user = userEvent.setup();
    const view = renderCart();
    await user.click(view.getByRole('button', { name: 'add-p1-2' }));
    beginAttempt([{ productId: 'p1', quantity: 2 }]);
    expect(loadAttempt()).not.toBeNull();

    const nextAuth = authValue({ identityEpoch: 1, user: { ...authValue().user!, id: 'user-2' } });
    view.rerender(
      <AuthContext.Provider value={nextAuth}>
        <CartProvider>
          <Probe />
        </CartProvider>
      </AuthContext.Provider>,
    );

    expect(lines(view)).toEqual([]);
    expect(loadAttempt()).toBeNull();
  });

  it('does not clear anything on a normal session restore (epoch stays 0)', async () => {
    const user = userEvent.setup();
    const view = renderCart();
    await user.click(view.getByRole('button', { name: 'add-p2-3' }));
    view.rerender(
      <AuthContext.Provider value={authValue()}>
        <CartProvider>
          <Probe />
        </CartProvider>
      </AuthContext.Provider>,
    );
    expect(lines(view)).toEqual([{ productId: 'p2', quantity: 3 }]);
  });
});
