import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollUntil } from './poll';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollUntil', () => {
  it('stops at the first decisive value without waiting', async () => {
    const load = vi.fn(async () => 'done' as const);
    const result = await pollUntil({ load, isDone: (value) => value === 'done' });
    expect(result).toEqual({ status: 'value', value: 'done' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('backs off between attempts until the value is decisive', async () => {
    let calls = 0;
    const onValue = vi.fn();
    const load = vi.fn(async () => {
      calls += 1;
      return calls;
    });
    const promise = pollUntil({
      load,
      isDone: (count) => count >= 3,
      attempts: 5,
      baseDelayMs: 10,
      onValue,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);

    await expect(promise).resolves.toEqual({ status: 'value', value: 3 });
    expect(load).toHaveBeenCalledTimes(3);
    expect(onValue).toHaveBeenCalledTimes(3);
  });

  it('gives up after the bounded number of attempts', async () => {
    const load = vi.fn(async () => 'waiting');
    const promise = pollUntil({
      load,
      isDone: () => false,
      attempts: 3,
      baseDelayMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);

    const result = await promise;
    expect(result.status).toBe('timeout');
    expect(result.value).toBe('waiting');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('retries a retryable error and succeeds on a later attempt', async () => {
    const failure = Object.assign(new Error('network down'), { retryable: true });
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw failure;
      return 'ok';
    });
    const promise = pollUntil({
      load,
      isDone: () => true,
      attempts: 2,
      baseDelayMs: 5,
      retryable: (error) => Boolean((error as { retryable?: boolean }).retryable),
    });

    await vi.advanceTimersByTimeAsync(5);

    await expect(promise).resolves.toEqual({ status: 'value', value: 'ok' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-retryable error immediately', async () => {
    const failure = new Error('not found');
    const load = vi.fn(async () => {
      throw failure;
    });
    const promise = pollUntil({
      load,
      isDone: () => true,
      retryable: () => false,
    });

    await expect(promise).rejects.toBe(failure);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not start when already cancelled', async () => {
    const load = vi.fn(async () => 'value');
    const result = await pollUntil({ load, isDone: () => true, signal: { cancelled: true } });
    expect(result.status).toBe('cancelled');
    expect(load).not.toHaveBeenCalled();
  });

  it('stops during a backoff wait when the page unmounts', async () => {
    const signal = { cancelled: false };
    const load = vi.fn(async () => 'waiting');
    const promise = pollUntil({
      load,
      isDone: () => false,
      signal,
      attempts: 5,
      baseDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);

    signal.cancelled = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toEqual({ status: 'cancelled' });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
