/**
 * Unit tests for AuthService.
 *
 * Tests token generation, verification, login flow, refresh, logout,
 * and session management logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
  },
}));

import {
  verifyAccessToken,
  verifyRefreshToken,
  login,
  refresh,
  logout,
  listSessions,
  revokeSession,
  touchSession,
  cleanExpiredSessions,
  AuthError,
} from './auth.service.js';
import { query } from '../db/index.js';
import bcrypt from 'bcrypt';

const mockQuery = vi.mocked(query);
const mockBcryptCompare = vi.mocked(bcrypt.compare);

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set env vars for tests
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.SESSION_INACTIVITY_TIMEOUT_MS = '1800000';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.SESSION_INACTIVITY_TIMEOUT_MS;
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid access token and returns payload', () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const token = jwt.sign(payload, 'dev-jwt-secret', { expiresIn: '15m' });

      const result = verifyAccessToken(token);

      expect(result.userId).toBe('user-1');
      expect(result.role).toBe('dispatcher');
      expect(result.sessionId).toBe('sess-1');
    });

    it('throws on expired token', () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const token = jwt.sign(payload, 'dev-jwt-secret', { expiresIn: '-1s' });

      expect(() => verifyAccessToken(token)).toThrow();
    });

    it('throws on invalid signature', () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '15m' });

      expect(() => verifyAccessToken(token)).toThrow();
    });
  });

  describe('verifyRefreshToken', () => {
    it('verifies a valid refresh token and returns payload', () => {
      const payload = { userId: 'user-1', role: 'responder', sessionId: 'sess-2' };
      const token = jwt.sign(payload, 'dev-refresh-secret', { expiresIn: '7d' });

      const result = verifyRefreshToken(token);

      expect(result.userId).toBe('user-1');
      expect(result.role).toBe('responder');
    });

    it('throws on invalid refresh token', () => {
      const token = jwt.sign({}, 'wrong-secret', { expiresIn: '7d' });

      expect(() => verifyRefreshToken(token)).toThrow();
    });
  });

  describe('login', () => {
    it('returns tokens and user info on valid credentials', async () => {
      // Mock: find user
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          role: 'dispatcher',
          name: 'Test User',
          email: 'test@example.com',
          password_hash: '$2b$10$hashed',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock: bcrypt compare returns true
      mockBcryptCompare.mockResolvedValueOnce(true as never);

      // Mock: insert session
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'session-456' }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      // Mock: update token hash
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await login('test@example.com', 'password123', { browser: 'Chrome' });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.id).toBe('user-123');
      expect(result.user.role).toBe('dispatcher');
      expect(result.user.email).toBe('test@example.com');

      // Verify the access token is valid
      const decoded = jwt.verify(result.accessToken, 'dev-jwt-secret') as { userId: string; sessionId: string };
      expect(decoded.userId).toBe('user-123');
      expect(decoded.sessionId).toBe('session-456');
    });

    it('throws AuthError on invalid email', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(login('nonexistent@example.com', 'password'))
        .rejects.toThrow('Invalid email or password');
    });

    it('throws AuthError on wrong password', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          role: 'dispatcher',
          name: 'Test',
          email: 'test@example.com',
          password_hash: '$2b$10$hashed',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockBcryptCompare.mockResolvedValueOnce(false as never);

      await expect(login('test@example.com', 'wrong'))
        .rejects.toThrow(AuthError);
    });

    it('throws AuthError when user has no password_hash', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          role: 'survivor',
          name: 'Test',
          email: 'test@example.com',
          password_hash: null,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(login('test@example.com', 'password'))
        .rejects.toThrow('Invalid email or password');
    });
  });

  describe('refresh', () => {
    it('returns new token pair on valid refresh token with active session', async () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const refreshToken = jwt.sign(payload, 'dev-refresh-secret', { expiresIn: '7d' });

      // Mock: find session
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sess-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 86400000),
          last_active_at: new Date(),
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock: get user role
      mockQuery.mockResolvedValueOnce({
        rows: [{ role: 'dispatcher' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock: update session token hash
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await refresh(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();

      // Verify the new access token is decodable and has correct payload
      const decoded = jwt.verify(result.accessToken, 'dev-jwt-secret') as { userId: string; role: string; sessionId: string };
      expect(decoded.userId).toBe('user-1');
      expect(decoded.role).toBe('dispatcher');
      expect(decoded.sessionId).toBe('sess-1');

      // Verify the session was updated with new token hash
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE sessions SET token_hash');
    });

    it('throws on invalid refresh token signature', async () => {
      const badToken = jwt.sign({ userId: 'user-1', role: 'x', sessionId: 's' }, 'wrong-secret');

      await expect(refresh(badToken)).rejects.toThrow(AuthError);
      await expect(refresh(badToken)).rejects.toThrow('Invalid refresh token');
    });

    it('throws when session is not found', async () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const refreshToken = jwt.sign(payload, 'dev-refresh-secret', { expiresIn: '7d' });

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(refresh(refreshToken)).rejects.toThrow('Session not found or revoked');
    });

    it('throws and deletes session on absolute expiry', async () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const refreshToken = jwt.sign(payload, 'dev-refresh-secret', { expiresIn: '7d' });

      // Session expired
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sess-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() - 1000), // expired
          last_active_at: new Date(),
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock: delete session
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await expect(refresh(refreshToken)).rejects.toThrow('Session expired');
    });

    it('throws and deletes session on inactivity timeout', async () => {
      const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
      const refreshToken = jwt.sign(payload, 'dev-refresh-secret', { expiresIn: '7d' });

      // Session not expired but inactive > 30 min
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sess-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 86400000),
          last_active_at: new Date(Date.now() - 1800001), // 30 min + 1 ms ago
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock: delete session
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await expect(refresh(refreshToken)).rejects.toThrow('Session expired due to inactivity');
    });
  });

  describe('logout', () => {
    it('deletes the session', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await expect(logout('sess-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws when session not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await expect(logout('non-existent', 'user-1')).rejects.toThrow('Session not found');
    });
  });

  describe('listSessions', () => {
    it('returns active sessions for a user', async () => {
      const now = new Date();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'sess-1',
            device_info: { browser: 'Chrome' },
            created_at: now,
            last_active_at: now,
            expires_at: new Date(now.getTime() + 86400000),
          },
          {
            id: 'sess-2',
            device_info: null,
            created_at: now,
            last_active_at: now,
            expires_at: new Date(now.getTime() + 86400000),
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const sessions = await listSessions('user-1');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('sess-1');
      expect(sessions[0].deviceInfo).toEqual({ browser: 'Chrome' });
      expect(sessions[1].deviceInfo).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('deletes the specified session', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await expect(revokeSession('sess-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws when session not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await expect(revokeSession('non-existent', 'user-1'))
        .rejects.toThrow(AuthError);
    });
  });

  describe('touchSession', () => {
    it('updates last_active_at', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await expect(touchSession('sess-1')).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE sessions SET last_active_at = NOW() WHERE id = $1',
        ['sess-1']
      );
    });
  });

  describe('cleanExpiredSessions', () => {
    it('returns count of deleted sessions', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 5,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      const count = await cleanExpiredSessions();
      expect(count).toBe(5);
    });
  });

  describe('AuthError', () => {
    it('has correct name and status code', () => {
      const err = new AuthError('test message', 403);
      expect(err.name).toBe('AuthError');
      expect(err.message).toBe('test message');
      expect(err.statusCode).toBe(403);
    });

    it('defaults to 401 status', () => {
      const err = new AuthError('unauthorized');
      expect(err.statusCode).toBe(401);
    });
  });
});
