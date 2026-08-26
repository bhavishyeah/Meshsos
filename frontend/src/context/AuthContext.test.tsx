import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from './AuthContext';

// Helper component to inspect AuthContext values
function AuthConsumer({ onRender }: { onRender: (ctx: ReturnType<typeof useAuth>) => void }) {
  const ctx = useAuth();
  onRender(ctx);
  return (
    <div>
      <span data-testid="isAuthenticated">{String(ctx.isAuthenticated)}</span>
      <span data-testid="isLoading">{String(ctx.isLoading)}</span>
      <span data-testid="user">{ctx.user ? ctx.user.name : 'null'}</span>
      <button onClick={() => ctx.login('test@example.com', 'password123')}>Login</button>
      <button onClick={() => ctx.logout()}>Logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    // Default: refresh fails (user not authenticated)
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Not authenticated' }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws error when useAuth is used outside AuthProvider', () => {
    // Suppress React error boundary noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      function Orphan() {
        useAuth();
        return null;
      }
      render(<Orphan />);
    }).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });

  it('starts with isLoading true and attempts refresh on mount', async () => {
    let capturedCtx: ReturnType<typeof useAuth> | null = null;
    const onRender = (ctx: ReturnType<typeof useAuth>) => {
      capturedCtx = ctx;
    };

    render(
      <AuthProvider>
        <AuthConsumer onRender={onRender} />
      </AuthProvider>,
    );

    // After mount, refresh was attempted
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/refresh'),
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });

    // After failed refresh, state should be not authenticated
    await waitFor(() => {
      expect(capturedCtx?.isLoading).toBe(false);
      expect(capturedCtx?.isAuthenticated).toBe(false);
      expect(capturedCtx?.user).toBeNull();
    });
  });

  it('restores session on mount when refresh succeeds', async () => {
    const mockUser = { id: '1', role: 'administrator', name: 'Admin', email: 'admin@test.com' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: mockUser, accessToken: 'fresh-token-123' }),
    });

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(capturedCtx?.isLoading).toBe(false);
      expect(capturedCtx?.isAuthenticated).toBe(true);
      expect(capturedCtx?.user).toEqual(mockUser);
      expect(capturedCtx?.accessToken).toBe('fresh-token-123');
    });
  });

  it('login succeeds with valid credentials', async () => {
    const mockUser = { id: '2', role: 'dispatcher', name: 'Dispatch', email: 'dispatch@test.com' };

    // First call is refresh on mount (fails), second is login
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // refresh
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: mockUser, accessToken: 'login-token' }),
      }); // login

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isLoading).toBe(false));

    let result: unknown;
    await act(async () => {
      result = await capturedCtx!.login('dispatch@test.com', 'password123');
    });

    expect(result).toEqual({ success: true, user: mockUser, accessToken: 'login-token' });
    expect(capturedCtx?.isAuthenticated).toBe(true);
    expect(capturedCtx?.user).toEqual(mockUser);
  });

  it('login returns mfaRequired when backend responds with it', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // refresh
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ mfaRequired: true, userId: 'user-mfa' }),
      });

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isLoading).toBe(false));

    let result: unknown;
    await act(async () => {
      result = await capturedCtx!.login('user@test.com', 'pass');
    });

    expect(result).toEqual({ mfaRequired: true, userId: 'user-mfa' });
    // Should NOT be authenticated yet
    expect(capturedCtx?.isAuthenticated).toBe(false);
  });

  it('login returns mfaSetupRequired when backend responds with it', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // refresh
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ mfaSetupRequired: true, userId: 'user-setup' }),
      });

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isLoading).toBe(false));

    let result: unknown;
    await act(async () => {
      result = await capturedCtx!.login('user@test.com', 'pass');
    });

    expect(result).toEqual({ mfaSetupRequired: true, userId: 'user-setup' });
    expect(capturedCtx?.isAuthenticated).toBe(false);
  });

  it('login returns error on invalid credentials', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // refresh
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid credentials' }),
      });

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isLoading).toBe(false));

    let result: unknown;
    await act(async () => {
      result = await capturedCtx!.login('bad@test.com', 'wrong');
    });

    expect(result).toEqual({ success: false, error: 'Invalid credentials' });
    expect(capturedCtx?.isAuthenticated).toBe(false);
  });

  it('login returns network error on fetch failure', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // refresh
      .mockRejectedValueOnce(new Error('Network error'));

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isLoading).toBe(false));

    let result: unknown;
    await act(async () => {
      result = await capturedCtx!.login('user@test.com', 'pass');
    });

    expect(result).toEqual({ success: false, error: 'Network error. Please try again.' });
  });

  it('logout clears state and redirects to #/login', async () => {
    const mockUser = { id: '1', role: 'administrator', name: 'Admin', email: 'admin@test.com' };

    // Refresh succeeds on mount
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: mockUser, accessToken: 'token-123' }),
    });

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isAuthenticated).toBe(true));

    // Now mock the logout call
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    await act(async () => {
      await capturedCtx!.logout();
    });

    expect(capturedCtx?.isAuthenticated).toBe(false);
    expect(capturedCtx?.user).toBeNull();
    expect(capturedCtx?.accessToken).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('logout clears state even when backend call fails', async () => {
    const mockUser = { id: '1', role: 'administrator', name: 'Admin', email: 'admin@test.com' };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: mockUser, accessToken: 'token-123' }),
    });

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.isAuthenticated).toBe(true));

    // Logout endpoint throws
    fetchMock.mockRejectedValueOnce(new Error('Server down'));

    await act(async () => {
      await capturedCtx!.logout();
    });

    expect(capturedCtx?.isAuthenticated).toBe(false);
    expect(capturedCtx?.user).toBeNull();
    expect(window.location.hash).toBe('#/login');
  });

  it('refreshToken sets isLoading false on network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    let capturedCtx: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <AuthConsumer onRender={(ctx) => { capturedCtx = ctx; }} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(capturedCtx?.isLoading).toBe(false);
      expect(capturedCtx?.isAuthenticated).toBe(false);
    });
  });
});
