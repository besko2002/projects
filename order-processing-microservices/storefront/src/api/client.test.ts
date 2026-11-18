import { describe, expect, it, vi } from 'vitest';
import {
  ApiException,
  getToken,
  request,
  setToken,
  setUnauthorizedHandler,
} from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  it('sends the bearer token and accepts JSON headers', async () => {
    setToken('token-1');
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse({ ok: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(request<{ ok: boolean }>('/api/test')).resolves.toEqual({ ok: true });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('signs out and notifies once when a token-bearing request gets 401', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    setToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ status: 401, error: 'Unauthorized', message: 'Authentication required' }, 401),
      ),
    );

    await expect(request('/api/orders')).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not treat a 401 without a token as an expired session', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ status: 401, error: 'Unauthorized', message: 'Authentication required' }, 401),
      ),
    );

    await expect(request('/api/auth/login')).rejects.toBeInstanceOf(ApiException);
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps network failures to a retryable ApiException', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const error = await request('/api/products').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiException);
    const apiError = error as ApiException;
    expect(apiError.status).toBe(0);
    expect(apiError.retryable).toBe(true);
    expect(apiError.message).toContain('could not be reached');
  });

  it('marks 429 and 5xx retryable, and business errors not retryable', async () => {
    const cases: Array<[number, boolean]> = [
      [429, true],
      [500, true],
      [502, true],
      [400, false],
      [404, false],
      [409, false],
    ];
    for (const [status, retryable] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse({ status, error: 'Error', message: 'nope' }, status)),
      );
      const error = (await request('/api/test').catch((err: unknown) => err)) as ApiException;
      expect(error.status, `status ${status}`).toBe(status);
      expect(error.retryable, `status ${status}`).toBe(retryable);
    }
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(request('/api/test', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('describes a 5xx without a JSON body and keeps field errors from 400s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } })),
    );
    const gatewayError = (await request('/api/test').catch((err: unknown) => err)) as ApiException;
    expect(gatewayError.message).toContain('temporarily unavailable');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            status: 400,
            error: 'Bad Request',
            message: 'Validation failed',
            fieldErrors: { email: 'must be a well-formed email address' },
          },
          400,
        ),
      ),
    );
    const validationError = (await request('/api/auth/register').catch((err: unknown) => err)) as ApiException;
    expect(validationError.fieldErrors).toEqual({ email: 'must be a well-formed email address' });
  });
});
