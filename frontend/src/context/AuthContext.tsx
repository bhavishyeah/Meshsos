import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config/env';
import { setTokenGetter, setTokenSetter } from '../services/api';

// --- Types ---

export interface AuthUser {
  id: string;
  role: string;
  name: string;
  email: string;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type LoginResult =
  | { success: true; user: AuthUser; accessToken: string }
  | { mfaRequired: true; userId: string }
  | { mfaSetupRequired: true; userId: string; user: AuthUser; accessToken: string }
  | { success: false; error: string };

export interface AuthContextValue extends AuthState {
  login(email: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  refreshToken(): Promise<boolean>;
  completeLogin(user: AuthUser, accessToken: string): void;
}

// --- Context ---

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hook to access the auth context.
 * Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// --- Provider ---

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: true, // true during initial refresh attempt
  });

  // Use a ref to always have the latest accessToken available for the token getter
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = state.accessToken;

  // Wire up api.ts token getter/setter on mount
  useEffect(() => {
    setTokenGetter(() => tokenRef.current);
    setTokenSetter((token: string) => {
      setState((prev) => ({ ...prev, accessToken: token }));
    });
  }, []);

  /**
   * Attempt to refresh the session using the HTTP-only cookie.
   * Called on app mount to restore sessions.
   * Returns true if session was restored, false otherwise.
   */
  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        setState((prev) => ({
          ...prev,
          user: null,
          accessToken: null,
          isAuthenticated: false,
          isLoading: false,
        }));
        return false;
      }

      const data = await response.json();
      setState({
        user: data.user,
        accessToken: data.accessToken,
        isAuthenticated: true,
        isLoading: false,
      });
      return true;
    } catch {
      setState((prev) => ({
        ...prev,
        user: null,
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,
      }));
      return false;
    }
  }, []);

  /**
   * Log in with email and password.
   * Returns a LoginResult indicating success, MFA requirement, or failure.
   */
  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }

      // MFA required — user needs to provide TOTP code
      if (data.mfaRequired) {
        return { mfaRequired: true, userId: data.userId };
      }

      // MFA setup required — user needs to set up TOTP
      if (data.mfaSetupRequired) {
        return { mfaSetupRequired: true, userId: data.user.id, user: data.user, accessToken: data.accessToken };
      }

      // Successful login — store user and token in state
      setState({
        user: data.user,
        accessToken: data.accessToken,
        isAuthenticated: true,
        isLoading: false,
      });

      return { success: true, user: data.user, accessToken: data.accessToken };
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, []);

  /**
   * Log out the current user.
   * Calls the backend logout endpoint, clears local state, and redirects to login.
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
        },
      });
    } catch {
      // Even if the backend call fails, clear local state
    }

    setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });

    window.location.hash = '#/login';
  }, []);

  /**
   * Complete login after MFA setup/verification.
   * Sets auth state with the provided user and token.
   */
  const completeLogin = useCallback((user: AuthUser, accessToken: string): void => {
    setState({
      user,
      accessToken,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  // Attempt session restoration on mount
  useEffect(() => {
    refreshToken();
  }, [refreshToken]);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refreshToken,
    completeLogin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
