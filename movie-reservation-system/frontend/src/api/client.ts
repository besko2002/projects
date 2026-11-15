import type { ApiError } from '../types/api';

const TOKEN_KEY = 'cinebook_token';
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
    // Ignore storage errors in restricted contexts
  }
}

export function getToken(): string | null {
  return currentToken;
}

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
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    if (token === getToken()) {
      setToken(null);
      if (unauthorizedHandler) {
        unauthorizedHandler();
      }
    }
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = text ? { message: text } : null;
  }

  if (!response.ok) {
    const err = data as Partial<ApiError>;
    throw new ApiException({
      status: response.status,
      error: err?.error || response.statusText,
      message: err?.message || `Request failed with status ${response.status}`,
      fieldErrors: err?.fieldErrors,
      path: err?.path,
    });
  }

  return data as T;
}
