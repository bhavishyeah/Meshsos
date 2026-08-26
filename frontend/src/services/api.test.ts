import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  authFetch,
  getAuthHeaders,
  setTokenGetter,
  setTokenSetter,
} from './api';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('api service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTokenGetter(() => null);
    setTokenSetter(() => {});
    window.location.hash = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthHeaders', () => {
    it('returns empty object when no token is set', () => {
      setTokenGetter(() => null);
      expect(getAuthHeaders()).toEqual({});
    });

    it('returns Authorization header when token is set', () => {
      setTokenGetter(() => 'test-token-123');
      expect(getAuthHeaders()).toEqual({
        Authorization: 'Bearer test-token-123',
      });
    });
  });

  describe('authFetch', () => {
    it('attaches Authorization header to requests', async () => {
      setTokenGetter(() => 'my-access-token');
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/test');
      expect(opts.headers.get('Authorization')).toBe('Bearer my-access-token');
      expect(opts.credentials).toBe('include');
    });

    it('does not set Authorization header when token is null', async () => {
      setTokenGetter(() => null);
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/test');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.has('Authorization')).toBe(false);
    });

    it('passes through request options', async () => {
      setTokenGetter(() => 'token');
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.body).toBe(JSON.stringify({ name: 'test' }));
    });

    it('returns the response directly on non-401 status', async () => {
      setTokenGetter(() => 'token');
      mockFetch.mockResolvedValueOnce(new Response('data', { status: 200 }));

      const response = await authFetch('/api/resource');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('attempts token refresh on 401 response', async () => {
      setTokenGetter(() => 'expired-token');
      const setter = vi.fn();
      setTokenSetter(setter);

      // First call returns 401
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      // Refresh call returns new token
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'new-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      // Retry call returns success
      mockFetch.mockResolvedValueOnce(new Response('success', { status: 200 }));

      const response = await authFetch('/api/protected');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify refresh call
      const [refreshUrl, refreshOpts] = mockFetch.mock.calls[1];
      expect(refreshUrl).toContain('/api/auth/refresh');
      expect(refreshOpts.method).toBe('POST');
      expect(refreshOpts.credentials).toBe('include');

      // Verify retry uses new token
      const [, retryOpts] = mockFetch.mock.calls[2];
      expect(retryOpts.headers.get('Authorization')).toBe('Bearer new-token');

      // Verify token setter was called
      expect(setter).toHaveBeenCalledWith('new-token');
    });

    it('redirects to #/login when refresh fails', async () => {
      setTokenGetter(() => 'expired-token');

      // First call returns 401
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      // Refresh call also fails
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const response = await authFetch('/api/protected');

      // Should return the original 401 response
      expect(response.status).toBe(401);
      // Should redirect to login
      expect(window.location.hash).toBe('#/login');
    });

    it('deduplicates concurrent refresh requests', async () => {
      setTokenGetter(() => 'expired-token');
      const setter = vi.fn();
      setTokenSetter(setter);

      // Two concurrent calls both get 401
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      // Single refresh call
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'refreshed-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      // Two retries succeed
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const [resp1, resp2] = await Promise.all([
        authFetch('/api/resource1'),
        authFetch('/api/resource2'),
      ]);

      expect(resp1.status).toBe(200);
      expect(resp2.status).toBe(200);

      // Should have: 2 original calls + 1 refresh (deduplicated) + 2 retries = 5
      // Note: due to deduplication, only 1 refresh call is made
      const refreshCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/auth/refresh'),
      );
      expect(refreshCalls.length).toBe(1);
    });

    it('handles refresh network failure gracefully', async () => {
      setTokenGetter(() => 'expired-token');

      // First call returns 401
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      // Refresh call throws network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const response = await authFetch('/api/protected');

      expect(response.status).toBe(401);
      expect(window.location.hash).toBe('#/login');
    });

    it('sets Content-Type for string body requests', async () => {
      setTokenGetter(() => 'token');
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.get('Content-Type')).toBe('application/json');
    });

    it('does not override Content-Type if already set', async () => {
      setTokenGetter(() => 'token');
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: 'form-data',
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.get('Content-Type')).toBe('multipart/form-data');
    });
  });
});
