/**
 * Authentication Middleware for MeshSOS.
 *
 * Verifies JWT access tokens from the Authorization header.
 * Attaches the authenticated user context to the request object.
 * Optionally updates session last_active_at for activity tracking.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, touchSession, type TokenPayload } from '../services/auth.service.js';

/**
 * Authenticated user shape attached to req.user.
 * Combines auth token fields with the shape expected by RBAC middleware.
 * The auth middleware always sets all fields; userId and sessionId are
 * optional to allow minimal user objects in non-auth contexts (e.g., tests).
 */
export interface AuthenticatedUser {
  /** User ID (primary key) */
  id: string;
  /** User ID from JWT payload (same as id, for convenience) */
  userId?: string;
  /** User role */
  role: string;
  /** Session ID from JWT payload */
  sessionId?: string;
  /** User email (populated when available) */
  email?: string;
}

/**
 * Extend Express Request to include authenticated user info.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Build the AuthenticatedUser object from a decoded JWT payload.
 */
function buildUser(payload: TokenPayload): AuthenticatedUser {
  return {
    id: payload.userId,
    userId: payload.userId,
    role: payload.role,
    sessionId: payload.sessionId,
  };
}

/**
 * Middleware that requires a valid JWT access token.
 * Extracts the token from the Authorization: Bearer <token> header.
 * On success, attaches decoded payload to req.user and updates session activity.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const payload = verifyAccessToken(token);
    req.user = buildUser(payload);

    // Update session activity in the background (don't block the request)
    touchSession(payload.sessionId).catch(() => {
      // Non-critical: log but don't fail the request
    });

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/**
 * Middleware that optionally authenticates (does not reject unauthenticated requests).
 * Useful for endpoints that behave differently for authenticated vs unauthenticated users.
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = verifyAccessToken(token);
      req.user = buildUser(payload);
      touchSession(payload.sessionId).catch(() => {});
    } catch {
      // Token invalid — proceed without user context
    }
  }

  next();
}

/**
 * Factory for role-based authorization middleware.
 * Must be used after `authenticate` middleware.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
