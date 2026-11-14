import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, setToken, getToken, setUnauthorizedHandler, ApiException } from '../api/client';

describe('API Client and Error Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches Bearer token header when set', async () => {
    setToken('test-jwt-token');
    expect(getToken()).toBe('test-jwt-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request<{ success: boolean }>('/api/test');
    expect(res).toEqual({ success: true });

    const callHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(callHeaders.get('Authorization')).toBe('Bearer test-jwt-token');
  });

  it('handles 401 Unauthorized by clearing token and calling unauthorizedHandler', async () => {
    setToken('expired-token');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 401, error: 'Unauthorized', message: 'Token expired' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/api/protected')).rejects.toThrow(ApiException);
    expect(getToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('parses ApiError and fieldErrors into ApiException', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        status: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        fieldErrors: { password: 'Password too short' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await request('/api/register');
      expect.fail('Should have thrown ApiException');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      const apiErr = err as ApiException;
      expect(apiErr.status).toBe(400);
      expect(apiErr.error).toBe('Bad Request');
      expect(apiErr.message).toBe('Validation failed');
      expect(apiErr.fieldErrors).toEqual({ password: 'Password too short' });
    }
  });

  it('returns undefined for 204 No Content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request<void>('/api/auth/logout', { method: 'POST' });
    expect(res).toBeUndefined();
  });
});
