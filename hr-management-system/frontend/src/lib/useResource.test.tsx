import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useResource } from './useResource';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('awaitable resource reload', () => {
  it.each(['success', 'failure', 'unmount'] as const)('waits for %s rather than releasing on an older request', async (outcome) => {
    const requests = [deferred<string>(), deferred<string>(), deferred<string>()];
    let calls = 0;
    const { result, unmount } = renderHook(() => useResource(() => requests[calls++].promise, 'today'));
    let settled = false;
    act(() => { void Promise.resolve(result.current.reload()).then(() => { settled = true; }); });
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => { requests[0].resolve('stale'); });
    expect(settled).toBe(false);
    // Focus can supersede the mutation reload: only the newest request may release it.
    act(() => { void result.current.reload(); });
    await waitFor(() => expect(calls).toBe(3));
    await act(async () => { requests[1].resolve('superseded'); });
    expect(settled).toBe(false);
    await act(async () => {
      if (outcome === 'success') requests[2].resolve('fresh');
      else if (outcome === 'failure') requests[2].reject(new Error('Refresh unavailable'));
      else unmount();
    });
    expect(settled).toBe(true);
    if (outcome === 'success') expect(result.current.data).toBe('fresh');
    if (outcome === 'failure') expect(result.current.error).toBe('Refresh unavailable');
  });
});
