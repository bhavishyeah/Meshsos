/**
 * Authentication Service for MeshSOS.
 *
 * Handles login, logout, token refresh, and session management.
 * Uses JWT access tokens (short-lived, 15min) and refresh tokens
 * stored as hashed values in the sessions table.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../db/index.js';

// Environment configuration
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret';
const SESSION_INACTIVITY_TIMEOUT_MS = parseInt(
  process.env.SESSION_INACTIVITY_TIMEOUT_MS ?? '1800000', // 30 minutes
  10
);
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface TokenPayload {
  userId: string;
  role: string;
  sessionId: string;
}

export interface SessionInfo {
  id: string;
  deviceInfo: Record<string, unknown> | null;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    role: string;
    name: string | null;
    email: string;
  };
}

/**
 * Hash a refresh token for storage in the sessions table.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a JWT access token.
 */
function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Generate a refresh token (opaque, signed JWT with longer expiry).
 */
function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000),
  });
}

/**
 * Verify an access token and return its payload.
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

/**
 * Verify a refresh token and return its payload.
 */
export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
}

/**
 * Authenticate a user with email and password.
 * Creates a new session and returns tokens.
 */
export async function login(
  email: string,
  password: string,
  deviceInfo?: Record<string, unknown>
): Promise<LoginResult> {
  // Find user by email
  const userResult = await query<{
    id: string;
    role: string;
    name: string | null;
    email: string;
    password_hash: string | null;
  }>(
    'SELECT id, role, name, email, password_hash FROM users WHERE email = $1',
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new AuthError('Invalid email or password', 401);
  }

  const user = userResult.rows[0];

  if (!user.password_hash) {
    throw new AuthError('Invalid email or password', 401);
  }

  // Verify password
  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) {
    throw new AuthError('Invalid email or password', 401);
  }

  // Create session
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  const tokenPayload: TokenPayload = {
    userId: user.id,
    role: user.role,
    sessionId: '', // will be set after session creation
  };

  const refreshToken = generateRefreshToken({ ...tokenPayload, sessionId: 'pending' });
  const tokenHash = hashToken(refreshToken);

  const sessionResult = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, device_info, expires_at, last_active_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    [user.id, tokenHash, deviceInfo ? JSON.stringify(deviceInfo) : null, expiresAt]
  );

  const sessionId = sessionResult.rows[0].id;

  // Generate final tokens with correct session ID
  const finalPayload: TokenPayload = {
    userId: user.id,
    role: user.role,
    sessionId,
  };

  const accessToken = generateAccessToken(finalPayload);
  const finalRefreshToken = generateRefreshToken(finalPayload);

  // Update the token hash with the final refresh token
  const finalTokenHash = hashToken(finalRefreshToken);
  await query('UPDATE sessions SET token_hash = $1 WHERE id = $2', [
    finalTokenHash,
    sessionId,
  ]);

  return {
    accessToken,
    refreshToken: finalRefreshToken,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    },
  };
}

/**
 * Refresh an expired access token using a valid refresh token.
 * Validates session is still active and not expired due to inactivity.
 */
export async function refresh(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  // Verify refresh token signature
  let payload: TokenPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AuthError('Invalid refresh token', 401);
  }

  const tokenHash = hashToken(refreshToken);

  // Find the session by token hash
  const sessionResult = await query<{
    id: string;
    user_id: string;
    expires_at: Date;
    last_active_at: Date;
  }>(
    `SELECT id, user_id, expires_at, last_active_at FROM sessions
     WHERE token_hash = $1 AND user_id = $2`,
    [tokenHash, payload.userId]
  );

  if (sessionResult.rows.length === 0) {
    throw new AuthError('Session not found or revoked', 401);
  }

  const session = sessionResult.rows[0];

  // Check if session has expired
  if (new Date(session.expires_at) < new Date()) {
    await query('DELETE FROM sessions WHERE id = $1', [session.id]);
    throw new AuthError('Session expired', 401);
  }

  // Check inactivity timeout
  const lastActive = new Date(session.last_active_at).getTime();
  if (Date.now() - lastActive > SESSION_INACTIVITY_TIMEOUT_MS) {
    await query('DELETE FROM sessions WHERE id = $1', [session.id]);
    throw new AuthError('Session expired due to inactivity', 401);
  }

  // Get the user's current role (may have changed)
  const userResult = await query<{ role: string }>(
    'SELECT role FROM users WHERE id = $1',
    [payload.userId]
  );

  if (userResult.rows.length === 0) {
    await query('DELETE FROM sessions WHERE id = $1', [session.id]);
    throw new AuthError('User not found', 401);
  }

  const currentRole = userResult.rows[0].role;

  // Generate new token pair (token rotation)
  const newPayload: TokenPayload = {
    userId: payload.userId,
    role: currentRole,
    sessionId: session.id,
  };

  const newAccessToken = generateAccessToken(newPayload);
  const newRefreshToken = generateRefreshToken(newPayload);
  const newTokenHash = hashToken(newRefreshToken);

  // Update session with new token hash and last active time
  await query(
    'UPDATE sessions SET token_hash = $1, last_active_at = NOW() WHERE id = $2',
    [newTokenHash, session.id]
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * Revoke a session (logout). Deletes the session record.
 */
export async function logout(sessionId: string, userId: string): Promise<void> {
  const result = await query(
    'DELETE FROM sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );

  if (result.rowCount === 0) {
    throw new AuthError('Session not found', 404);
  }
}

/**
 * List all active sessions for a user.
 */
export async function listSessions(userId: string): Promise<SessionInfo[]> {
  const result = await query<{
    id: string;
    device_info: Record<string, unknown> | null;
    created_at: Date;
    last_active_at: Date;
    expires_at: Date;
  }>(
    `SELECT id, device_info, created_at, last_active_at, expires_at
     FROM sessions
     WHERE user_id = $1 AND expires_at > NOW()
     ORDER BY last_active_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    deviceInfo: row.device_info,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    expiresAt: row.expires_at,
  }));
}

/**
 * Revoke a specific session for a user.
 */
export async function revokeSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const result = await query(
    'DELETE FROM sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );

  if (result.rowCount === 0) {
    throw new AuthError('Session not found', 404);
  }
}

/**
 * Update session last_active_at timestamp (called on authenticated requests).
 */
export async function touchSession(sessionId: string): Promise<void> {
  await query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [
    sessionId,
  ]);
}

/**
 * Clean up expired sessions (can be called periodically).
 */
export async function cleanExpiredSessions(): Promise<number> {
  const result = await query(
    'DELETE FROM sessions WHERE expires_at < NOW()'
  );
  return result.rowCount ?? 0;
}

/**
 * Custom error class for auth-related errors.
 */
export class AuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}
