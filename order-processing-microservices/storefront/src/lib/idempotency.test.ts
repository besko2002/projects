import { describe, expect, it } from 'vitest';
import {
  attemptMatchesCart,
  beginAttempt,
  clearAttempt,
  loadAttempt,
  saveAttempt,
} from './idempotency';

describe('checkout attempt persistence', () => {
  it('persists the key and payload before any request is made', () => {
    const attempt = beginAttempt([{ productId: 'p1', quantity: 2 }]);
    expect(attempt.key).toBeTruthy();
    expect(attempt.payload.items).toEqual([{ productId: 'p1', quantity: 2 }]);
    expect(attempt.orderId).toBeNull();

    const reloaded = loadAttempt();
    expect(reloaded?.key).toBe(attempt.key);
    expect(reloaded?.payload).toEqual(attempt.payload);
  });

  it('keeps the same key across unlimited reloads until cleared', () => {
    const first = beginAttempt([{ productId: 'p1', quantity: 1 }]);
    const second = loadAttempt();
    const third = loadAttempt();
    expect(second?.key).toBe(first.key);
    expect(third?.key).toBe(first.key);
  });

  it('remembers the created order id', () => {
    const attempt = beginAttempt([{ productId: 'p1', quantity: 1 }]);
    saveAttempt({ ...attempt, orderId: 'order-42' });
    expect(loadAttempt()?.orderId).toBe('order-42');
  });

  it('matches only the exact same cart (ids, quantities, order)', () => {
    const attempt = beginAttempt([
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ]);
    expect(attemptMatchesCart(attempt, [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ])).toBe(true);

    expect(attemptMatchesCart(attempt, [
      { productId: 'p1', quantity: 3 },
      { productId: 'p2', quantity: 1 },
    ])).toBe(false);
    expect(attemptMatchesCart(attempt, [
      { productId: 'p2', quantity: 1 },
      { productId: 'p1', quantity: 2 },
    ])).toBe(false);
    expect(attemptMatchesCart(attempt, [{ productId: 'p1', quantity: 2 }])).toBe(false);
    expect(attemptMatchesCart(null, [{ productId: 'p1', quantity: 2 }])).toBe(false);
  });

  it('drops a corrupt record instead of breaking checkout', () => {
    window.localStorage.setItem('outline_store_checkout_attempt', '{not json');
    expect(loadAttempt()).toBeNull();
    expect(window.localStorage.getItem('outline_store_checkout_attempt')).toBeNull();
  });

  it('rejects a stored payload that could not have been sent', () => {
    window.localStorage.setItem(
      'outline_store_checkout_attempt',
      JSON.stringify({
        key: 'key-1',
        payload: { items: [{ productId: 'p1', quantity: 0 }] },
        orderId: null,
        startedAt: '2026-11-17T10:00:00Z',
      }),
    );
    expect(loadAttempt()).toBeNull();
  });

  it('clears the attempt only on an explicit resolution', () => {
    beginAttempt([{ productId: 'p1', quantity: 1 }]);
    expect(loadAttempt()).not.toBeNull();
    clearAttempt();
    expect(loadAttempt()).toBeNull();
  });
});
