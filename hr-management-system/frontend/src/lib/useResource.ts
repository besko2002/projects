import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from '../api/ApiError';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Refetches with the same loader, e.g. after a mutation. */
  reload: () => Promise<void>;
  /** Replaces the held value without a round trip. */
  setData: (value: T) => void;
}

/**
 * One GET per screen, with loading and error state and an aborted request on unmount.
 * `key` is what identifies the request (a URL-ish string): changing it refetches. The
 * loader lives in a ref so an inline arrow does not restart the effect on every render.
 *
 * A 401 is swallowed here: the api client already told the auth provider to end the
 * session, and the route guard is about to replace this screen with /login.
 */
export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  key: string,
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  const reloadSequence = useRef(0);
  const waiters = useRef<{ sequence: number; resolve: () => void }[]>([]);

  useEffect(() => () => {
    waiters.current.splice(0).forEach(({ resolve }) => resolve());
  }, []);

  // Keep the latest loader without restarting the fetch effect. Declared before it, so on every
  // render the ref is current by the time the fetch effect runs.
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    // A new key (or reload) starts a new request, so the screen must go back to "loading" now.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    loaderRef
      .current(controller.signal)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          return;
        }
        setError(errorMessage(cause));
        setLoading(false);
      })
      .finally(() => {
        // A superseded request must not release a mutation's refresh barrier.
        if (!cancelled) {
          const settled = waiters.current.filter((waiter) => waiter.sequence <= nonce);
          waiters.current = waiters.current.filter((waiter) => waiter.sequence > nonce);
          settled.forEach(({ resolve }) => resolve());
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, nonce]);

  const reload = useCallback((): Promise<void> => {
    const sequence = ++reloadSequence.current;
    return new Promise((resolve) => {
      waiters.current.push({ sequence, resolve });
      setNonce(sequence);
    });
  }, []);

  const replace = useCallback((value: T): void => {
    setData(value);
  }, []);

  return { data, error, loading, reload, setData: replace };
}
