/**
 * Unit tests for DeduplicationService.
 *
 * Tests checkDuplicate() and flagDuplicate() functions including:
 * - No duplicates when no recent SOS exists
 * - High confidence: same session + same type + within 5 min
 * - High confidence: same session + same type + same location
 * - Medium confidence: same user + same type + within 5 min + within 500m
 * - Medium confidence: same type + within 1 min + within 100m (different device)
 * - No duplicate when emergency types differ
 * - No duplicate when time window exceeded
 * - flagDuplicate updates the database correctly
 *
 * Requirements: 34.1, 34.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock geo-dispatch haversineDistance
vi.mock('./geo-dispatch.service.js', () => ({
  haversineDistance: vi.fn(),
}));

import {
  checkDuplicate,
  flagDuplicate,
  type DeduplicationInput,
  type RecentSOSRow,
} from './deduplication.service.js';
import { query } from '../db/index.js';
import { haversineDistance } from './geo-dispatch.service.js';

const mockQuery = vi.mocked(query);
const mockHaversine = vi.mocked(haversineDistance);

describe('DeduplicationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkDuplicate()', () => {
    const baseInput: DeduplicationInput = {
      sosId: 'new-sos-id',
      userSessionId: 'session-123',
      userId: 'user-456',
      emergencyType: 'medical',
      latitude: 28.6139,
      longitude: 77.2090,
      createdAt: new Date('2024-01-15T10:00:00Z'),
    };

    it('returns no duplicate when no recent SOS exists', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await checkDuplicate(baseInput);

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateOf).toBeNull();
      expect(result.confidence).toBe('low');
      expect(result.reasons).toEqual([]);
    });

    it('queries with correct time window (30 minutes) and same emergency type', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await checkDuplicate(baseInput);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('emergency_type = $4'),
        expect.arrayContaining([
          'new-sos-id',
          expect.any(String), // windowStart
          '2024-01-15T10:00:00.000Z', // createdAt
          'medical',
        ])
      );

      // Verify the window start is 30 minutes before createdAt
      const callArgs = mockQuery.mock.calls[0][1] as string[];
      const windowStart = new Date(callArgs[1]);
      const expectedWindowStart = new Date('2024-01-15T09:30:00Z');
      expect(windowStart.getTime()).toBe(expectedWindowStart.getTime());
    });

    it('returns high confidence when same session + same type + within 5 min', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-1',
        user_session_id: 'session-123',
        user_id: 'user-456',
        emergency_type: 'medical',
        latitude: null,
        longitude: null,
        created_at: '2024-01-15T09:57:00Z', // 3 minutes before
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await checkDuplicate(baseInput);

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateOf).toBe('existing-sos-1');
      expect(result.confidence).toBe('high');
      expect(result.reasons).toContain('same_session');
      expect(result.reasons).toContain('same_emergency_type');
      expect(result.reasons).toContain('within_5_minutes');
    });

    it('returns high confidence when same session + same type + same location (within 500m)', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-2',
        user_session_id: 'session-123',
        user_id: 'user-456',
        emergency_type: 'medical',
        latitude: 28.614,
        longitude: 77.209,
        created_at: '2024-01-15T09:40:00Z', // 20 minutes before (beyond 5 min)
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Return distance within 500m
      mockHaversine.mockReturnValue(0.3);

      const result = await checkDuplicate(baseInput);

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateOf).toBe('existing-sos-2');
      expect(result.confidence).toBe('high');
      expect(result.reasons).toContain('same_session');
      expect(result.reasons).toContain('within_500_meters');
    });

    it('returns medium confidence when same user + same type + within 5 min + within 500m', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-3',
        user_session_id: 'different-session', // different session
        user_id: 'user-456', // same user
        emergency_type: 'medical',
        latitude: 28.614,
        longitude: 77.209,
        created_at: '2024-01-15T09:56:00Z', // 4 minutes before
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Return distance within 500m
      mockHaversine.mockReturnValue(0.4);

      const result = await checkDuplicate({
        ...baseInput,
        userSessionId: 'new-session-xyz', // different session
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateOf).toBe('existing-sos-3');
      expect(result.confidence).toBe('medium');
      expect(result.reasons).toContain('same_user');
      expect(result.reasons).toContain('within_5_minutes');
      expect(result.reasons).toContain('within_500_meters');
    });

    it('returns medium confidence when same type + within 1 min + within 100m (cross-device)', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-4',
        user_session_id: 'other-session', // different session
        user_id: 'other-user', // different user
        emergency_type: 'medical',
        latitude: 28.6139,
        longitude: 77.2090,
        created_at: '2024-01-15T09:59:30Z', // 30 seconds before
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Return distance within 100m
      mockHaversine.mockReturnValue(0.05);

      const result = await checkDuplicate({
        ...baseInput,
        userSessionId: 'completely-different-session',
        userId: 'completely-different-user',
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateOf).toBe('existing-sos-4');
      expect(result.confidence).toBe('medium');
      expect(result.reasons).toContain('within_1_minute');
      expect(result.reasons).toContain('within_100_meters');
    });

    it('returns no duplicate when only emergency type matches but no other criteria', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-5',
        user_session_id: 'other-session',
        user_id: 'other-user',
        emergency_type: 'medical',
        latitude: 28.7,
        longitude: 77.3,
        created_at: '2024-01-15T09:45:00Z', // 15 minutes before
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Return distance > 500m
      mockHaversine.mockReturnValue(5.0);

      const result = await checkDuplicate({
        ...baseInput,
        userSessionId: 'no-match-session',
        userId: 'no-match-user',
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateOf).toBeNull();
      expect(result.confidence).toBe('low');
    });

    it('returns no duplicate when all SOS in time window have different emergency type', async () => {
      // The query filters by emergency_type, so no rows returned
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await checkDuplicate({
        ...baseInput,
        emergencyType: 'police', // different from existing 'medical' SOS
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateOf).toBeNull();
    });

    it('picks the highest confidence match when multiple candidates exist', async () => {
      const candidateMedium: RecentSOSRow = {
        id: 'medium-match',
        user_session_id: 'other-session',
        user_id: 'other-user',
        emergency_type: 'medical',
        latitude: 28.6139,
        longitude: 77.2090,
        created_at: '2024-01-15T09:59:30Z', // 30 seconds before
      };

      const candidateHigh: RecentSOSRow = {
        id: 'high-match',
        user_session_id: 'session-123', // same session
        user_id: 'user-456',
        emergency_type: 'medical',
        latitude: null,
        longitude: null,
        created_at: '2024-01-15T09:58:00Z', // 2 minutes before
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidateMedium, candidateHigh],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // For candidateMedium: within 100m
      mockHaversine.mockReturnValue(0.05);

      const result = await checkDuplicate(baseInput);

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateOf).toBe('high-match');
      expect(result.confidence).toBe('high');
    });

    it('handles null location in input gracefully', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-6',
        user_session_id: 'other-session',
        user_id: 'other-user',
        emergency_type: 'medical',
        latitude: 28.614,
        longitude: 77.209,
        created_at: '2024-01-15T09:59:30Z',
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await checkDuplicate({
        ...baseInput,
        latitude: null,
        longitude: null,
        userSessionId: 'other-session-2',
        userId: 'other-user-2',
      });

      // No location comparison possible, no session/user match, so no duplicate
      expect(result.isDuplicate).toBe(false);
      expect(mockHaversine).not.toHaveBeenCalled();
    });

    it('handles null session and user ID with location-based detection', async () => {
      const candidate: RecentSOSRow = {
        id: 'existing-sos-7',
        user_session_id: null,
        user_id: null,
        emergency_type: 'medical',
        latitude: 28.6139,
        longitude: 77.2090,
        created_at: '2024-01-15T09:59:45Z', // 15 seconds before
      };

      mockQuery.mockResolvedValueOnce({
        rows: [candidate],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Within 100m
      mockHaversine.mockReturnValue(0.08);

      const result = await checkDuplicate({
        ...baseInput,
        userSessionId: null,
        userId: null,
      });

      // Rule 4: same type + within 1 min + within 100m → medium
      expect(result.isDuplicate).toBe(true);
      expect(result.confidence).toBe('medium');
      expect(result.reasons).toContain('within_1_minute');
      expect(result.reasons).toContain('within_100_meters');
    });
  });

  describe('flagDuplicate()', () => {
    it('updates sos_incidents with duplicate_flag and duplicate_of', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await flagDuplicate('sos-123', 'original-sos-456');

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE sos_incidents SET duplicate_flag = true, duplicate_of = $2 WHERE id = $1',
        ['sos-123', 'original-sos-456']
      );
    });
  });
});
