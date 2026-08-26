import { API_BASE_URL } from '../config/env';

/**
 * Module-level token accessor.
 *
 * AuthContext calls `setTokenGetter` on mount to wire its state into this module.
 * This avoids circular imports between api.ts and AuthContext.
 */
let tokenGetter: () => string | null = () => null;
let tokenSetter: ((token: string) => void) | null = null;

/**
 * Register the getter used by authFetch to read the current access token.
 * Called once by AuthContext on initialization.
 */
export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter;
}

/**
 * Register the setter used by authFetch to update the access token after a refresh.
 * Called once by AuthContext on initialization.
 */
export function setTokenSetter(setter: (token: string) => void): void {
  tokenSetter = setter;
}

/**
 * Returns the current Authorization headers for components that
 * need to build custom requests outside of authFetch.
 */
export function getAuthHeaders(): Record<string, string> {
  const token = tokenGetter();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Tracks whether a refresh is already in flight to avoid duplicate refresh calls.
 */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the HTTP-only refresh cookie.
 * Returns the new access token on success, or null on failure.
 */
async function attemptRefresh(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends the HTTP-only refresh cookie
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Deduplicated refresh: if a refresh is already in progress, piggyback on it.
 */
async function refreshToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = attemptRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Authenticated fetch wrapper.
 *
 * - Attaches `Authorization: Bearer <token>` to every request
 * - On 401: attempts a token refresh via `POST /api/auth/refresh`
 *   - If refresh succeeds: retries the original request with the new token
 *   - If refresh fails: redirects to `#/login`
 * - Passes `credentials: 'include'` to send cookies (for refresh token)
 *
 * Requirements: 1.5, 1.6, 9.1
 */
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = tokenGetter();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status !== 401) {
    return response;
  }

  // 401 received — attempt token refresh
  const newToken = await refreshToken();

  if (!newToken) {
    // Refresh failed — redirect to login
    window.location.hash = '#/login';
    return response;
  }

  // Notify AuthContext of the new token
  if (tokenSetter) {
    tokenSetter(newToken);
  }

  // Retry the original request with the refreshed token
  const retryHeaders = new Headers(options.headers);
  retryHeaders.set('Authorization', `Bearer ${newToken}`);
  if (!retryHeaders.has('Content-Type') && options.body && typeof options.body === 'string') {
    retryHeaders.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers: retryHeaders,
    credentials: 'include',
  });
}
