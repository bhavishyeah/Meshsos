/**
 * Authentication Routes for MeshSOS.
 *
 * POST /api/auth/login       - Authenticate and get tokens
 * POST /api/auth/logout      - Revoke current session
 * POST /api/auth/refresh     - Refresh access token using refresh cookie
 * GET  /api/auth/sessions    - List user's active sessions
 * DELETE /api/auth/sessions/:id - Revoke a specific session
 */

import { Router, type Request, type Response } from 'express';
import {
  login,
  logout,
  refresh,
  listSessions,
  revokeSession,
  AuthError,
} from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { isPrivilegedRole, requiresMFA, needsMFASetup } from '../services/mfa.service.js';

const router = Router();

// Cookie configuration for refresh tokens
const REFRESH_COOKIE_NAME = 'meshsos_refresh_token';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    path: '/api/auth',
  });
}

/**
 * POST /api/auth/login
 * Body: { email, password, deviceInfo? }
 * Returns: { accessToken, user } for non-privileged roles
 * Returns: { mfaRequired: true, userId, needsSetup? } for privileged roles with MFA
 * Sets: HTTP-only refresh cookie (only for non-MFA or after MFA completion)
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, deviceInfo } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const result = await login(email, password, deviceInfo);

    // Check if this user requires MFA
    if (isPrivilegedRole(result.user.role)) {
      const mfaRequired = await requiresMFA(result.user.id);
      const needsSetup = await needsMFASetup(result.user.id);

      if (mfaRequired) {
        // Don't issue full tokens yet — user must complete MFA verification
        // Return partial response indicating MFA is needed
        res.status(200).json({
          mfaRequired: true,
          userId: result.user.id,
          user: result.user,
          message: 'MFA verification required to complete login',
        });
        return;
      }

      if (needsSetup) {
        // Privileged user hasn't set up MFA yet — allow login but flag setup needed
        // Issue tokens but indicate MFA setup is required
        setRefreshCookie(res, result.refreshToken);
        res.status(200).json({
          accessToken: result.accessToken,
          user: result.user,
          mfaSetupRequired: true,
          message: 'MFA setup is required for your role. Please configure MFA.',
        });
        return;
      }
    }

    // Non-privileged role or MFA not applicable — full access
    setRefreshCookie(res, result.refreshToken);

    // Return access token and user info (NOT the refresh token in body)
    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Requires: Authentication (Bearer token)
 * Revokes the current session and clears the refresh cookie.
 */
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.user!.sessionId!;
    await logout(sessionId, userId);

    clearRefreshCookie(res);
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/refresh
 * Reads refresh token from HTTP-only cookie.
 * Returns: { accessToken }
 * Sets: New HTTP-only refresh cookie (token rotation)
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token not found' });
      return;
    }

    const result = await refresh(refreshToken);

    // Set the new refresh token cookie (token rotation)
    setRefreshCookie(res, result.refreshToken);

    res.status(200).json({
      accessToken: result.accessToken,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      clearRefreshCookie(res);
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/sessions
 * Requires: Authentication (Bearer token)
 * Returns: List of active sessions for the authenticated user.
 */
router.get('/sessions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const sessions = await listSessions(userId);

    res.status(200).json({ sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/auth/sessions/:id
 * Requires: Authentication (Bearer token)
 * Revokes a specific session for the authenticated user.
 */
router.delete('/sessions/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.params.id;

    await revokeSession(sessionId, userId);

    res.status(200).json({ message: 'Session revoked' });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('Revoke session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as authRouter };
