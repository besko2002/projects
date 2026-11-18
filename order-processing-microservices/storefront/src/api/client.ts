import type { ApiError } from '../types/api';

const TOKEN_KEY = 'outline_store_token';
let currentToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

try {
  currentToken = window.localStorage.getItem(TOKEN_KEY);
} catch {
  currentToken = null;
}

export function setToken(token: string | null): void {
  currentToken = token;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory token still works.
  }
}

export function getToken(): string | null {
  return currentToken;
}

/** Called once when an authenticated request answers 401, i.e. the session is no longer valid. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export class ApiException extends Error {
  readonly status: number;
  readonly error: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(apiError: ApiError) {
    super(apiError.message || apiError.error || `HTTP ${apiError.status}`);
    this.name = 'ApiException';
    this.status = apiError.status;
    this.error = apiError.error;
    this.fieldErrors = apiError.fieldErrors;
  }

  /** Network failure, gateway down, or a 5xx/429: the same request may succeed later. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export const NETWORK_ERROR_STATUS = 0;

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiException({
      status: NETWORK_ERROR_STATUS,
      error: 'Network error',
      message: 'The store could not be reached. Check your connection and try again.',
    });
  }

  // A 401 on a request that carried a token means the session expired or was revoked. A 401
  // without a token (e.g. wrong password on sign-in) is a normal error for the caller to show.
  if (response.status === 401 && token && token === getToken()) {
    setToken(null);
    unauthorizedHandler?.();
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  let data: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiException({
      status: response.status,
      error: err.error || response.statusText || 'Error',
      message: err.message || defaultMessage(response.status),
      fieldErrors: err.fieldErrors,
      path: err.path,
    });
  }

  return data as T;
}

function defaultMessage(status: number): string {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The store is temporarily unavailable. Please try again.';
  return `Request failed with status ${status}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiException) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}
