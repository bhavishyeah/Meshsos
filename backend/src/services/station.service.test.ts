/**
 * Unit tests for Station Service.
 *
 * Tests CRUD operations for stations (police, hospital, relief centers).
 * Mocks the database layer and audit service.
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4
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

import {
  createStation,
  getStationById,
  listStations,
  updateStation,
  deactivateStation,
  validateCoordinates,
  StationValidationError,
} from './station.service.js';
import { query } from '../db/index.js';
import { record } from './audit.service.js';

const mockQuery = vi.mocked(query);
const mockRecord = vi.mocked(record);

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const ACTOR_ID = 'user-admin-001';

const STATION_ROW = {
  id: 'station-001',
  name: 'Central Police Station',
  type: 'police',
  latitude: 12.9716,
  longitude: 77.5946,
  region_id: 'region-001',
  contact: '+1-555-0100',
  capacity: null,
  services: null,
  officer_count: 50,
  status: 'active',
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
};

const HOSPITAL_ROW = {
  id: 'station-002',
  name: 'City General Hospital',
  type: 'hospital',
  latitude: 13.0827,
  longitude: 80.2707,
  region_id: 'region-002',
  contact: '+1-555-0200',
  capacity: 200,
  services: { emergency: true, icu: true, surgery: true },
  officer_count: null,
  status: 'active',
  created_at: new Date('2024-01-02T00:00:00Z'),
  updated_at: new Date('2024-01-02T00:00:00Z'),
};

const RELIEF_ROW = {
  id: 'station-003',
  name: 'North Relief Center',
  type: 'relief',
  latitude: -33.8688,
  longitude: 151.2093,
  region_id: 'region-003',
  contact: '+1-555-0300',
  capacity: 500,
  services: { food: true, shelter: true },
  officer_count: null,
  status: 'active',
  created_at: new Date('2024-01-03T00:00:00Z'),
  updated_at: new Date('2024-01-03T00:00:00Z'),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Station Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateCoordinates()', () => {
    it('returns true for valid coordinates', () => {
      expect(validateCoordinates(12.9716, 77.5946)).toBe(true);
    });

    it('returns true for boundary values', () => {
      expect(validateCoordinates(-90, -180)).toBe(true);
      expect(validateCoordinates(90, 180)).toBe(true);
      expect(validateCoordinates(0, 0)).toBe(true);
    });

    it('returns false for latitude out of range', () => {
      expect(validateCoordinates(-91, 0)).toBe(false);
      expect(validateCoordinates(91, 0)).toBe(false);
    });

    it('returns false for longitude out of range', () => {
      expect(validateCoordinates(0, -181)).toBe(false);
      expect(validateCoordinates(0, 181)).toBe(false);
    });

    it('returns false for NaN values', () => {
      expect(validateCoordinates(NaN, 77)).toBe(false);
      expect(validateCoordinates(12, NaN)).toBe(false);
    });
  });

  describe('createStation()', () => {
    it('creates a police station and returns mapped record', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      const result = await createStation(
        {
          name: 'Central Police Station',
          type: 'police',
          latitude: 12.9716,
          longitude: 77.5946,
          regionId: 'region-001',
          contact: '+1-555-0100',
          officerCount: 50,
        },
        ACTOR_ID
      );

      expect(result.id).toBe('station-001');
      expect(result.name).toBe('Central Police Station');
      expect(result.type).toBe('police');
      expect(result.latitude).toBe(12.9716);
      expect(result.longitude).toBe(77.5946);
      expect(result.regionId).toBe('region-001');
      expect(result.officerCount).toBe(50);
      expect(result.status).toBe('active');
    });

    it('creates a hospital with services and capacity', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [HOSPITAL_ROW], rowCount: 1 } as never);

      const result = await createStation(
        {
          name: 'City General Hospital',
          type: 'hospital',
          latitude: 13.0827,
          longitude: 80.2707,
          regionId: 'region-002',
          contact: '+1-555-0200',
          capacity: 200,
          services: { emergency: true, icu: true, surgery: true },
        },
        ACTOR_ID
      );

      expect(result.id).toBe('station-002');
      expect(result.type).toBe('hospital');
      expect(result.capacity).toBe(200);
      expect(result.services).toEqual({ emergency: true, icu: true, surgery: true });
    });

    it('creates a relief center', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [RELIEF_ROW], rowCount: 1 } as never);

      const result = await createStation(
        {
          name: 'North Relief Center',
          type: 'relief',
          latitude: -33.8688,
          longitude: 151.2093,
          regionId: 'region-003',
          contact: '+1-555-0300',
          capacity: 500,
          services: { food: true, shelter: true },
        },
        ACTOR_ID
      );

      expect(result.id).toBe('station-003');
      expect(result.type).toBe('relief');
      expect(result.capacity).toBe(500);
    });

    it('records audit event on creation', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      await createStation(
        {
          name: 'Central Police Station',
          type: 'police',
          latitude: 12.9716,
          longitude: 77.5946,
        },
        ACTOR_ID
      );

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'facility:created',
          actorId: ACTOR_ID,
          targetEntityId: 'station-001',
        })
      );
    });

    it('throws StationValidationError for invalid coordinates', async () => {
      await expect(
        createStation(
          {
            name: 'Bad Station',
            type: 'police',
            latitude: 100, // Invalid
            longitude: 77.5946,
          },
          ACTOR_ID
        )
      ).rejects.toThrow(StationValidationError);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('throws StationValidationError for longitude out of range', async () => {
      await expect(
        createStation(
          {
            name: 'Bad Station',
            type: 'police',
            latitude: 12.9716,
            longitude: 200, // Invalid
          },
          ACTOR_ID
        )
      ).rejects.toThrow(StationValidationError);
    });

    it('passes correct SQL parameters including PostGIS point', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      await createStation(
        {
          name: 'Test Station',
          type: 'police',
          latitude: 12.9716,
          longitude: 77.5946,
          regionId: 'region-001',
          contact: '+1-555-0100',
          capacity: null,
          services: { patrol: true },
          officerCount: 10,
        },
        ACTOR_ID
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO stations'),
        expect.arrayContaining([
          'Test Station',
          'police',
          77.5946, // longitude first (for ST_MakePoint)
          12.9716, // latitude second
        ])
      );
    });
  });

  describe('getStationById()', () => {
    it('returns station when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      const result = await getStationById('station-001');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('station-001');
      expect(result!.name).toBe('Central Police Station');
    });

    it('returns null when station not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await getStationById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listStations()', () => {
    it('returns all stations when no filters are provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [STATION_ROW, HOSPITAL_ROW, RELIEF_ROW],
        rowCount: 3,
      } as never);

      const result = await listStations();

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('police');
      expect(result[1].type).toBe('hospital');
      expect(result[2].type).toBe('relief');
    });

    it('filters by type', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [HOSPITAL_ROW], rowCount: 1 } as never);

      const result = await listStations({ type: 'hospital' });

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('type = $1'),
        ['hospital']
      );
    });

    it('filters by status', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      await listStations({ status: 'active' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['active']
      );
    });

    it('filters by regionId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      await listStations({ regionId: 'region-001' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('region_id = $1'),
        ['region-001']
      );
    });

    it('combines multiple filters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await listStations({ type: 'police', status: 'active', regionId: 'region-001' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('type = $1'),
        ['police', 'active', 'region-001']
      );
    });

    it('returns empty array when no stations match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await listStations({ type: 'relief' });

      expect(result).toHaveLength(0);
    });
  });

  describe('updateStation()', () => {
    it('updates station name and records audit event', async () => {
      // First call: getStationById (coordinate validation check)
      // Second call: getStationById (for audit previous state)
      // Third call: UPDATE query
      mockQuery
        .mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never) // getStationById for current state
        .mockResolvedValueOnce({
          rows: [{ ...STATION_ROW, name: 'Updated Station' }],
          rowCount: 1,
        } as never); // UPDATE

      const result = await updateStation(
        'station-001',
        { name: 'Updated Station' },
        ACTOR_ID
      );

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated Station');
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'facility:updated',
          actorId: ACTOR_ID,
          targetEntityId: 'station-001',
        })
      );
    });

    it('updates station location with valid coordinates', async () => {
      // getStationById for coordinate validation + audit previous state
      mockQuery
        .mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never)
        .mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never)
        .mockResolvedValueOnce({
          rows: [{ ...STATION_ROW, latitude: 40.7128, longitude: -74.006 }],
          rowCount: 1,
        } as never);

      const result = await updateStation(
        'station-001',
        { latitude: 40.7128, longitude: -74.006 },
        ACTOR_ID
      );

      expect(result).not.toBeNull();
      expect(result!.latitude).toBe(40.7128);
      expect(result!.longitude).toBe(-74.006);
    });

    it('throws StationValidationError for invalid coordinates on update', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      await expect(
        updateStation('station-001', { latitude: 200 }, ACTOR_ID)
      ).rejects.toThrow(StationValidationError);
    });

    it('returns null when station not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await updateStation(
        'nonexistent',
        { name: 'X' },
        ACTOR_ID
      );

      expect(result).toBeNull();
    });

    it('returns current station when no fields to update', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never);

      const result = await updateStation('station-001', {}, ACTOR_ID);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('station-001');
      // Should not have called UPDATE (only the SELECT for getStationById)
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('deactivateStation()', () => {
    it('deactivates an active station', async () => {
      // First call: getStationById for current state
      // Second call: UPDATE setting status='inactive'
      mockQuery
        .mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never)
        .mockResolvedValueOnce({
          rows: [{ ...STATION_ROW, status: 'inactive' }],
          rowCount: 1,
        } as never);

      const result = await deactivateStation('station-001', ACTOR_ID);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('inactive');
    });

    it('records audit event on deactivation', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [STATION_ROW], rowCount: 1 } as never)
        .mockResolvedValueOnce({
          rows: [{ ...STATION_ROW, status: 'inactive' }],
          rowCount: 1,
        } as never);

      await deactivateStation('station-001', ACTOR_ID);

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'facility:deactivated',
          actorId: ACTOR_ID,
          targetEntityId: 'station-001',
          previousState: expect.stringContaining('active'),
          newState: expect.stringContaining('inactive'),
        })
      );
    });

    it('returns current station if already inactive (no-op)', async () => {
      const inactiveRow = { ...STATION_ROW, status: 'inactive' };
      mockQuery.mockResolvedValueOnce({ rows: [inactiveRow], rowCount: 1 } as never);

      const result = await deactivateStation('station-001', ACTOR_ID);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('inactive');
      // Should not perform the UPDATE since already inactive
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockRecord).not.toHaveBeenCalled();
    });

    it('returns null when station not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await deactivateStation('nonexistent', ACTOR_ID);

      expect(result).toBeNull();
    });
  });
});
