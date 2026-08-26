/**
 * Unit tests for Responder Service.
 *
 * Tests status management, retrieval by ID, and region-based queries.
 * Mocks the database layer, audit service, and WebSocket broadcasts.
 *
 * Requirements: 19.1, 19.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock the audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

// Mock the WebSocket module
vi.mock('../websocket/index.js', () => ({
  broadcastStatusChange: vi.fn(),
  broadcastLocationUpdate: vi.fn(),
}));

import {
  updateResponderStatus,
  getResponderById,
  getRespondersByRegion,
  isValidResponderStatus,
  VALID_RESPONDER_STATUSES,
  ResponderValidationError,
  updateResponderLocation,
  clearLocationThrottles,
  locationUpdateThrottles,
  LOCATION_THROTTLE_MS,
} from './responder.service.js';
import { query } from '../db/index.js';
import { record } from './audit.service.js';
import { broadcastStatusChange, broadcastLocationUpdate } from '../websocket/index.js';

const mockQuery = vi.mocked(query);
const mockRecord = vi.mocked(record);
const mockBroadcast = vi.mocked(broadcastStatusChange);
const mockBroadcastLocation = vi.mocked(broadcastLocationUpdate);

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const ACTOR_ID = 'user-dispatcher-001';
const RESPONDER_ID = 'responder-001';

const RESPONDER_ROW = {
  id: RESPONDER_ID,
  user_id: 'user-resp-001',
  organization: 'Metro Police',
  station_id: 'station-001',
  type: 'police',
  latitude: 12.9716,
  longitude: 77.5946,
  location_updated_at: new Date('2024-01-15T10:00:00Z'),
  status: 'available',
  current_incident_id: null,
  vehicle: 'Patrol Car 42',
  capabilities: { armed: true, firstAid: true },
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-15T10:00:00Z'),
};

const RESPONDER_ROW_2 = {
  id: 'responder-002',
  user_id: 'user-resp-002',
  organization: 'City Ambulance',
  station_id: 'station-002',
  type: 'medical',
  latitude: 12.985,
  longitude: 77.601,
  location_updated_at: new Date('2024-01-15T09:30:00Z'),
  status: 'busy',
  current_incident_id: 'incident-001',
  vehicle: 'Ambulance 7',
  capabilities: { emt: true, defib: true },
  created_at: new Date('2024-01-02T00:00:00Z'),
  updated_at: new Date('2024-01-15T09:30:00Z'),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Responder Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── isValidResponderStatus ─────────────────────────────────────────────

  describe('isValidResponderStatus', () => {
    it('should return true for all valid statuses', () => {
      for (const status of VALID_RESPONDER_STATUSES) {
        expect(isValidResponderStatus(status)).toBe(true);
      }
    });

    it('should return false for invalid statuses', () => {
      expect(isValidResponderStatus('invalid')).toBe(false);
      expect(isValidResponderStatus('')).toBe(false);
      expect(isValidResponderStatus('AVAILABLE')).toBe(false);
      expect(isValidResponderStatus('on_scene')).toBe(false);
    });
  });

  // ─── getResponderById ───────────────────────────────────────────────────

  describe('getResponderById', () => {
    it('should return a responder when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await getResponderById(RESPONDER_ID);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(RESPONDER_ID);
      expect(result!.userId).toBe('user-resp-001');
      expect(result!.organization).toBe('Metro Police');
      expect(result!.type).toBe('police');
      expect(result!.latitude).toBe(12.9716);
      expect(result!.longitude).toBe(77.5946);
      expect(result!.status).toBe('available');
      expect(result!.vehicle).toBe('Patrol Car 42');
      expect(result!.capabilities).toEqual({ armed: true, firstAid: true });
    });

    it('should return null when responder not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await getResponderById('nonexistent-id');
      expect(result).toBeNull();
    });

    it('should query with PostGIS location extraction', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });

      await getResponderById(RESPONDER_ID);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ST_Y(current_location::geometry) AS latitude'),
        [RESPONDER_ID]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ST_X(current_location::geometry) AS longitude'),
        [RESPONDER_ID]
      );
    });
  });

  // ─── getRespondersByRegion ──────────────────────────────────────────────

  describe('getRespondersByRegion', () => {
    it('should return responders belonging to a region via station join', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [RESPONDER_ROW, RESPONDER_ROW_2],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getRespondersByRegion('region-001');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(RESPONDER_ID);
      expect(result[1].id).toBe('responder-002');
    });

    it('should return empty array when no responders in region', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await getRespondersByRegion('region-empty');
      expect(result).toEqual([]);
    });

    it('should join with stations table on region_id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      await getRespondersByRegion('region-001');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN stations s ON r.station_id = s.id'),
        ['region-001']
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE s.region_id = $1'),
        ['region-001']
      );
    });
  });

  // ─── updateResponderStatus ──────────────────────────────────────────────

  describe('updateResponderStatus', () => {
    it('should update status and return updated responder', async () => {
      // First call: getResponderById (to get previous state)
      mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });
      // Second call: UPDATE query
      const updatedRow = { ...RESPONDER_ROW, status: 'busy', updated_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await updateResponderStatus(RESPONDER_ID, 'busy', ACTOR_ID);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('busy');
    });

    it('should return null when responder not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await updateResponderStatus('nonexistent', 'busy', ACTOR_ID);
      expect(result).toBeNull();
    });

    it('should record an audit event with previous and new status (Req 19.3)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });
      const updatedRow = { ...RESPONDER_ROW, status: 'enRoute' };
      mockQuery.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1, command: '', oid: 0, fields: [] });

      await updateResponderStatus(RESPONDER_ID, 'enRoute', ACTOR_ID);

      expect(mockRecord).toHaveBeenCalledWith({
        eventType: 'responder:statusChange',
        actorId: ACTOR_ID,
        targetEntityId: RESPONDER_ID,
        previousState: JSON.stringify({ status: 'available' }),
        newState: JSON.stringify({ status: 'enRoute' }),
        metadata: { responderId: RESPONDER_ID, previousStatus: 'available', newStatus: 'enRoute' },
      });
    });

    it('should broadcast status change via WebSocket', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });
      const updatedRow = { ...RESPONDER_ROW, status: 'onScene' };
      mockQuery.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1, command: '', oid: 0, fields: [] });

      await updateResponderStatus(RESPONDER_ID, 'onScene', ACTOR_ID);

      expect(mockBroadcast).toHaveBeenCalledWith({
        responderId: RESPONDER_ID,
        previousStatus: 'available',
        newStatus: 'onScene',
        timestamp: expect.any(Date),
      });
    });

    it('should throw ResponderValidationError for invalid status', async () => {
      await expect(
        updateResponderStatus(RESPONDER_ID, 'invalid_status' as any, ACTOR_ID)
      ).rejects.toThrow(ResponderValidationError);
    });

    it('should support all valid status transitions', async () => {
      for (const status of VALID_RESPONDER_STATUSES) {
        vi.clearAllMocks();
        mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });
        const updatedRow = { ...RESPONDER_ROW, status };
        mockQuery.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1, command: '', oid: 0, fields: [] });

        const result = await updateResponderStatus(RESPONDER_ID, status, ACTOR_ID);
        expect(result).not.toBeNull();
        expect(result!.status).toBe(status);
      }
    });

    it('should not record audit or broadcast when responder not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      await updateResponderStatus('nonexistent', 'busy', ACTOR_ID);

      expect(mockRecord).not.toHaveBeenCalled();
      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('should propagate audit service errors', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [RESPONDER_ROW], rowCount: 1, command: '', oid: 0, fields: [] });
      const updatedRow = { ...RESPONDER_ROW, status: 'busy' };
      mockQuery.mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1, command: '', oid: 0, fields: [] });
      mockRecord.mockRejectedValueOnce(new Error('Audit persistence failed'));

      await expect(
        updateResponderStatus(RESPONDER_ID, 'busy', ACTOR_ID)
      ).rejects.toThrow('Audit persistence failed');
    });
  });

  // ─── updateResponderLocation (Req 22.1, 22.2) ────────────────────────────

  describe('updateResponderLocation', () => {
    beforeEach(() => {
      clearLocationThrottles();
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });
    });

    describe('successful location update', () => {
      it('should persist location to the database', async () => {
        const result = await updateResponderLocation('resp-1', 40.7128, -74.006, 10);

        expect(result).toEqual({ updated: true });
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE responders'),
          [-74.006, 40.7128, 'resp-1']
        );
      });

      it('should pass longitude as $1 and latitude as $2 to ST_MakePoint', async () => {
        await updateResponderLocation('resp-1', 51.5074, -0.1278, 5);

        const [, params] = mockQuery.mock.calls[0];
        // ST_MakePoint(longitude, latitude) — $1=lng, $2=lat
        expect(params).toEqual([-0.1278, 51.5074, 'resp-1']);
      });

      it('should broadcast location to command center', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 34.0522, -118.2437, 8, now);

        expect(mockBroadcastLocation).toHaveBeenCalledWith({
          responderId: 'resp-1',
          latitude: 34.0522,
          longitude: -118.2437,
          accuracy: 8,
          timestamp: new Date(now),
        });
      });

      it('should record the timestamp in the throttle map', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);

        expect(locationUpdateThrottles.get('resp-1')).toBe(now);
      });
    });

    describe('throttling logic', () => {
      it('should reject updates within 5 seconds of the last update', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);
        mockQuery.mockClear();

        // Try again 3 seconds later — should be throttled
        const result = await updateResponderLocation('resp-1', 40.001, -74.001, 10, now + 3000);

        expect(result).toEqual({ updated: false, reason: 'throttled' });
        expect(mockQuery).not.toHaveBeenCalled();
      });

      it('should allow updates after the throttle window expires', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);

        // Try again after 5 seconds — should succeed
        const result = await updateResponderLocation('resp-1', 40.001, -74.001, 10, now + LOCATION_THROTTLE_MS);

        expect(result).toEqual({ updated: true });
        expect(mockQuery).toHaveBeenCalledTimes(2);
      });

      it('should throttle each responder independently', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);
        await updateResponderLocation('resp-2', 51.5, -0.1, 5, now);

        // Both throttled at same time
        const result1 = await updateResponderLocation('resp-1', 40.001, -74.001, 10, now + 2000);
        const result2 = await updateResponderLocation('resp-2', 51.501, -0.101, 5, now + 2000);

        expect(result1).toEqual({ updated: false, reason: 'throttled' });
        expect(result2).toEqual({ updated: false, reason: 'throttled' });
      });

      it('should allow first update for a new responder (no throttle history)', async () => {
        const result = await updateResponderLocation('new-resp', 40.0, -74.0, 10);

        expect(result).toEqual({ updated: true });
      });

      it('should update throttle timestamp on successful update', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);

        // After throttle expires, update again
        const laterTime = now + LOCATION_THROTTLE_MS + 1000;
        await updateResponderLocation('resp-1', 40.001, -74.001, 10, laterTime);

        // The throttle should now be based on the latest update
        expect(locationUpdateThrottles.get('resp-1')).toBe(laterTime);

        // Trying again immediately should be throttled
        const result = await updateResponderLocation('resp-1', 40.002, -74.002, 10, laterTime + 1000);
        expect(result).toEqual({ updated: false, reason: 'throttled' });
      });

      it('should not update the database when throttled', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);
        mockQuery.mockClear();

        await updateResponderLocation('resp-1', 40.001, -74.001, 10, now + 1000);

        expect(mockQuery).not.toHaveBeenCalled();
      });

      it('should not broadcast when throttled', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);
        mockBroadcastLocation.mockClear();

        await updateResponderLocation('resp-1', 40.001, -74.001, 10, now + 1000);

        expect(mockBroadcastLocation).not.toHaveBeenCalled();
      });
    });

    describe('coordinate validation', () => {
      it('should reject latitude above 90', async () => {
        const result = await updateResponderLocation('resp-1', 91, -74.0, 10);
        expect(result).toEqual({ updated: false, reason: 'invalid_coordinates' });
      });

      it('should reject latitude below -90', async () => {
        const result = await updateResponderLocation('resp-1', -91, -74.0, 10);
        expect(result).toEqual({ updated: false, reason: 'invalid_coordinates' });
      });

      it('should reject longitude above 180', async () => {
        const result = await updateResponderLocation('resp-1', 40.0, 181, 10);
        expect(result).toEqual({ updated: false, reason: 'invalid_coordinates' });
      });

      it('should reject longitude below -180', async () => {
        const result = await updateResponderLocation('resp-1', 40.0, -181, 10);
        expect(result).toEqual({ updated: false, reason: 'invalid_coordinates' });
      });

      it('should reject NaN latitude', async () => {
        const result = await updateResponderLocation('resp-1', NaN, -74.0, 10);
        expect(result).toEqual({ updated: false, reason: 'invalid_coordinates' });
      });

      it('should reject Infinity longitude', async () => {
        const result = await updateResponderLocation('resp-1', 40.0, Infinity, 10);
        expect(result).toEqual({ updated: false, reason: 'invalid_coordinates' });
      });

      it('should accept boundary values (90, 180)', async () => {
        const result = await updateResponderLocation('resp-1', 90, 180, 10);
        expect(result).toEqual({ updated: true });
      });

      it('should accept boundary values (-90, -180)', async () => {
        const result = await updateResponderLocation('resp-2', -90, -180, 10);
        expect(result).toEqual({ updated: true });
      });
    });

    describe('clearLocationThrottles', () => {
      it('should clear all throttle entries', async () => {
        const now = 1700000000000;
        await updateResponderLocation('resp-1', 40.0, -74.0, 10, now);
        await updateResponderLocation('resp-2', 51.5, -0.1, 5, now);

        clearLocationThrottles();

        expect(locationUpdateThrottles.size).toBe(0);

        // Both responders should be able to update immediately
        const r1 = await updateResponderLocation('resp-1', 40.0, -74.0, 10, now + 1000);
        const r2 = await updateResponderLocation('resp-2', 51.5, -0.1, 5, now + 1000);
        expect(r1).toEqual({ updated: true });
        expect(r2).toEqual({ updated: true });
      });
    });
  });
});
