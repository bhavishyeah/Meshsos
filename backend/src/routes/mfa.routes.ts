/**
 * MFA Routes - Setup and Verification endpoints
 *
 * POST /api/auth/mfa/setup  — Generate TOTP secret and return otpauth URI for QR code
 * POST /api/auth/mfa/verify — Verify a TOTP code (during login or initial setup)
 *
 * Requirements: 37.2, 1.3
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { z } from 'zod';
import {
  setupMFA,
  verifyMFA,
  isPrivilegedRole,
  needsMFASetup,
} from '../services/mfa.service.js';
import { loginAfterMFA } from '../services/auth.service.js';

export const mfaRouter = Router();

/**
 * POST /api/auth/mfa/setup
 *
 * Generates a TOTP secret for the authenticated user and returns the otpauth URI.
 * The user should scan this URI (as QR code) with their authenticator app.
 *
 * Requires: authenticated user with a privileged role (dispatcher/supervisor/administrator)
 *
 * Request body: none (user identity from auth context)
 * Response: { secret, otpauthUri }
 */
mfaRouter.post('/setup', authenticate, async (req: Request, res: Response) => {
  try {
    // The authenticated user info should be attached by auth middleware
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!isPrivilegedRole(user.role)) {
      res.status(403).json({ error: 'MFA setup is only available for privileged roles' });
      return;
    }

    const { secret, otpauthUri } = await setupMFA(user.id, user.email ?? '');

    res.status(200).json({
      secret,
      otpauthUri,
      message: 'Scan the QR code with your authenticator app, then verify with a code',
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({ error: 'Failed to set up MFA' });
  }
});

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies a TOTP code during login or initial MFA setup.
 *
 * During initial setup: verifies the code and enables MFA for the user.
 * During login: verifies the code and issues a full access token
 *   (the initial login for privileged roles returns a partial token with mfa_required: true).
 *
 * Request body: { code: string, userId: string }
 * Response on success: { verified: true, token?: string }
 * Response on failure: { verified: false, error: string }
 */
const verifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
  userId: z.string().uuid('Invalid user ID format'),
});

mfaRouter.post('/verify', async (req: Request, res: Response) => {
  try {
    const parseResult = verifySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parseResult.error.issues.map((i) => i.message),
      });
      return;
    }

    const { code, userId } = parseResult.data;

    // Verify the TOTP code
    const isValid = await verifyMFA(userId, code);

    if (!isValid) {
      res.status(401).json({
        verified: false,
        error: 'Invalid or expired MFA code',
      });
      return;
    }

    // MFA verification successful — issue full access token and refresh cookie
    const result = await loginAfterMFA(userId);

    // Set refresh token as HTTP-only cookie
    res.cookie('meshsos_refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth',
    });

    res.status(200).json({
      verified: true,
      mfaComplete: true,
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

/**
 * Type representing a request with authenticated user context.
 * The auth middleware (task 2.1) attaches this.
 */
export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email?: string;
    role: string;
    userId?: string;
    sessionId?: string;
  };
}
