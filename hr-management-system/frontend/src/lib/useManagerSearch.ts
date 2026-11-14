import { useEffect, useState } from 'react';
import { api } from '../api/api';
import { errorMessage } from '../api/ApiError';
import type { EmployeeRecord } from '../api/types';

/** How long the search waits before it asks the server. */
export const SEARCH_DEBOUNCE_MS = 250;

/** How many candidates one search returns. */
export const SEARCH_PAGE_SIZE = 20;

interface SearchState {
  results: EmployeeRecord[];
  loading: boolean;
  error: string | null;
}

export interface ManagerSearch {
  /** What the user typed. */
  query: string;
  /** Changes the query (and starts a new search). */
  setQuery: (value: string) => void;
  /** The candidates for the current query. */
  results: EmployeeRecord[];
  loading: boolean;
  error: string | null;
  /** Asks the server again with the same query. */
  reload: () => void;
  /** Drops the current query and shows the unfiltered list again. */
  clear: () => void;
}

/**
 * Searches the active employees by name, number or e-mail while the user types.
 *
 * <p>The old picker loaded the WHOLE roster - every active employee, 100 at a time - before it
 * showed anything: 200 requests and 14 seconds at 20,000 employees. This searches instead, with
 * the existing paged {@code q=} endpoint and a short debounce, so the cost does not grow with
 * the size of the company.
 *
 * @param key       identifies the search (a different key restarts it)
 * @param excludeId an employee that must not be offered (an employee is not their own manager)
 */
export function useManagerSearch(key: string, excludeId?: string): ManagerSearch {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ results: [], loading: false, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      // Nothing is searched while the field is empty: the caller offers "No manager (org root)".
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .listEmployees(
          { q: trimmed, status: 'ACTIVE', page: 0, size: SEARCH_PAGE_SIZE, sort: 'fullName,asc' },
          controller.signal,
        )
        .then((response) => {
          if (cancelled) {
            return;
          }
          setState({
            results: response.content.filter(
              (employee) => excludeId === undefined || employee.id !== excludeId,
            ),
            loading: false,
            error: null,
          });
        })
        .catch((cause: unknown) => {
          if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) {
            return;
          }
          setState({ results: [], loading: false, error: errorMessage(cause) });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, query, nonce, excludeId]);

  const trimmed = query.trim();

  return {
    query,
    setQuery: (value: string) => {
      setQuery(value);
      if (value.trim() !== '') {
        setState({ results: [], loading: true, error: null });
      }
    },
    results: trimmed === '' ? [] : state.results,
    loading: trimmed === '' ? false : state.loading,
    error: trimmed === '' ? null : state.error,
    reload: () => {
      setNonce((current) => current + 1);
    },
    clear: () => {
      setQuery('');
      setState({ results: [], loading: false, error: null });
    },
  };
}
