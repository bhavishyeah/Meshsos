/**
 * Unit tests for Suspicious Activity Detection Service.
 *
 * Tests checkSuspiciousActivity() and flagSuspiciousActivity() functions:
 * - Returns not suspicious when count is below threshold
 * - Returns suspicious when count meets threshold
 * - Returns suspicious when count exceeds threshold
 * - Returns not suspicious when no userId or sessionId provided
 * - Respects custom configuration for threshold and window
 * - Queries by userId only when sessionId is null
 * - Queries by sessionId only when userId is null
 * - Queries by both userId and sessionId (OR logic)
 * - flagSuspiciousActivity records audit event with correct data
 * - Never blocks SOS creation (no exceptions thrown for detection)
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock the audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn(),
}));

import { query } from '../db/index.js';
import { record } from './audit.service.js';
import {
  checkSuspiciousActivity,
  flagSuspiciousActivity,
  DEFAULT_CONFIG,
  type SuspiciousActivityConfig,
} from './suspicious-activity.service.js';

const mockQuery = vi.mocked(query);
const mockRecord = vi.mocked(record);

describe('SuspiciousActivityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSuspiciousActivity', () => {
    it('should return not suspicious when count is below threshold', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 3 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await checkSuspiciousActivity('user-1', 'session-1');

      expect(result.isSuspicious).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.sosCountInWindow).toBe(3);
    });

    it('should return suspicious when count meets threshold (default: 5)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 5 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await checkSuspiciousActivity('user-1', 'session-1');

      expect(result.isSuspicious).toBe(true);
      expect(result.reason).toContain('Exceeded SOS threshold');
      expect(result.reason).toContain('5 submissions');
      expect(result.sosCountInWindow).toBe(5);
    });

    it('should return suspicious when count exceeds threshold', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 8 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await checkSuspiciousActivity('user-1', 'session-1');

      expect(result.isSuspicious).toBe(true);
      expect(result.reason).toContain('8 submissions');
      expect(result.sosCountInWindow).toBe(8);
    });

    it('should return not suspicious when neither userId nor sessionId provided', async () => {
      const result = await checkSuspiciousActivity(null, null);

      expect(result.isSuspicious).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.sosCountInWindow).toBe(0);
      // Should not query the database
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should query by userId only when sessionId is null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 2 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      await checkSuspiciousActivity('user-1', null);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('user_id = $1');
      expect(sql).not.toContain('user_session_id');
      expect(params![0]).toBe('user-1');
    });

    it('should query by sessionId only when userId is null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 1 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      await checkSuspiciousActivity(null, 'session-abc');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('user_session_id = $1');
      expect(sql).not.toContain('user_id');
      expect(params![0]).toBe('session-abc');
    });

    it('should query by both userId and sessionId with OR logic', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 4 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      await checkSuspiciousActivity('user-1', 'session-abc');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('user_session_id = $2');
      expect(sql).toContain('OR');
      expect(params![0]).toBe('user-1');
      expect(params![1]).toBe('session-abc');
    });

    it('should respect custom configuration for threshold and window', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 3 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const customConfig: SuspiciousActivityConfig = {
        maxSOSPerWindow: 3,
        windowMs: 5 * 60 * 1000, // 5 minutes
      };

      const result = await checkSuspiciousActivity('user-1', null, customConfig);

      expect(result.isSuspicious).toBe(true);
      expect(result.reason).toContain('3 submissions');
      expect(result.reason).toContain('5 minute window');
    });

    it('should handle database returning zero count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 0 }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await checkSuspiciousActivity('user-1', 'session-1');

      expect(result.isSuspicious).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.sosCountInWindow).toBe(0);
    });

    it('should use default config values (5 SOS in 10 minutes)', () => {
      expect(DEFAULT_CONFIG.maxSOSPerWindow).toBe(5);
      expect(DEFAULT_CONFIG.windowMs).toBe(10 * 60 * 1000);
    });
  });

  describe('flagSuspiciousActivity', () => {
    it('should record audit event with correct event type and metadata', async () => {
      mockRecord.mockResolvedValueOnce(undefined);

      await flagSuspiciousActivity('sos-123', 'user-1', 'Exceeded threshold');

      expect(mockRecord).toHaveBeenCalledOnce();
      expect(mockRecord).toHaveBeenCalledWith({
        sosId: 'sos-123',
        eventType: 'sos:suspicious',
        actorId: 'user-1',
        metadata: expect.objectContaining({
          reason: 'Exceeded threshold',
          flaggedAt: expect.any(String),
        }),
      });
    });

    it('should use "system" as actorId when userId is null', async () => {
      mockRecord.mockResolvedValueOnce(undefined);

      await flagSuspiciousActivity('sos-456', null, 'Rapid submissions detected');

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
        })
      );
    });

    it('should include sosId in the audit record', async () => {
      mockRecord.mockResolvedValueOnce(undefined);

      await flagSuspiciousActivity('sos-789', 'user-2', 'Some reason');

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          sosId: 'sos-789',
        })
      );
    });

    it('should propagate audit service errors (does not swallow)', async () => {
      mockRecord.mockRejectedValueOnce(new Error('Audit write failed'));

      await expect(
        flagSuspiciousActivity('sos-err', 'user-1', 'test')
      ).rejects.toThrow('Audit write failed');
    });
  });
});
