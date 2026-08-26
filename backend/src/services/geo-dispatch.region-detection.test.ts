/**
 * Unit tests for Geo Dispatch Engine — Region Detection (detectRegion).
 *
 * Tests all logic branches:
 * - Invalid/missing GPS → unresolved_location
 * - Coordinates inside a region → resolved
 * - Coordinates outside all regions → unresolved_region
 * - Database error handling → unresolved_region fallback
 * - Coordinate boundary values
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 29.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import { detectRegion, isValidCoordinate, REGION_QUERY_TIMEOUT_MS } from './geo-dispatch.service.js';
import { query } from '../db/index.js';

const mockQuery = vi.mocked(query);

describe('Geo Dispatch Service — Region Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Constants ────────────────────────────────────────────────────────────

  describe('REGION_QUERY_TIMEOUT_MS', () => {
    it('is set to 2000ms per Requirement 29.1', () => {
      expect(REGION_QUERY_TIMEOUT_MS).toBe(2000);
    });
  });

  // ─── isValidCoordinate ──────────────────────────────────────────────────

  describe('isValidCoordinate()', () => {
    it('returns false for null latitude', () => {
      expect(isValidCoordinate(null, 77.5946)).toBe(false);
    });

    it('returns false for null longitude', () => {
      expect(isValidCoordinate(12.9716, null)).toBe(false);
    });

    it('returns false for both null', () => {
      expect(isValidCoordinate(null, null)).toBe(false);
    });

    it('returns false for undefined latitude', () => {
      expect(isValidCoordinate(undefined, 77.5946)).toBe(false);
    });

    it('returns false for undefined longitude', () => {
      expect(isValidCoordinate(12.9716, undefined)).toBe(false);
    });

    it('returns false for NaN latitude', () => {
      expect(isValidCoordinate(NaN, 77.5946)).toBe(false);
    });

    it('returns false for NaN longitude', () => {
      expect(isValidCoordinate(12.9716, NaN)).toBe(false);
    });

    it('returns false for latitude below -90', () => {
      expect(isValidCoordinate(-91, 77.5946)).toBe(false);
    });

    it('returns false for latitude above 90', () => {
      expect(isValidCoordinate(91, 77.5946)).toBe(false);
    });

    it('returns false for longitude below -180', () => {
      expect(isValidCoordinate(12.9716, -181)).toBe(false);
    });

    it('returns false for longitude above 180', () => {
      expect(isValidCoordinate(12.9716, 181)).toBe(false);
    });

    it('returns true for valid coordinates', () => {
      expect(isValidCoordinate(12.9716, 77.5946)).toBe(true);
    });

    it('returns true for boundary values (90, 180)', () => {
      expect(isValidCoordinate(90, 180)).toBe(true);
    });

    it('returns true for boundary values (-90, -180)', () => {
      expect(isValidCoordinate(-90, -180)).toBe(true);
    });

    it('returns true for zero coordinates (0, 0)', () => {
      expect(isValidCoordinate(0, 0)).toBe(true);
    });

    it('returns false for Infinity latitude', () => {
      expect(isValidCoordinate(Infinity, 77.5946)).toBe(false);
    });

    it('returns false for -Infinity longitude', () => {
      expect(isValidCoordinate(12.9716, -Infinity)).toBe(false);
    });
  });

  // ─── detectRegion — unresolved_location cases ───────────────────────────

  describe('detectRegion() — unresolved_location (Req 29.4)', () => {
    it('returns unresolved_location when lat is null', async () => {
      const result = await detectRegion(null, 77.5946);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location when lng is null', async () => {
      const result = await detectRegion(12.9716, null);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location when both are null', async () => {
      const result = await detectRegion(null, null);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location for NaN latitude', async () => {
      const result = await detectRegion(NaN, 77.5946);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location for NaN longitude', async () => {
      const result = await detectRegion(12.9716, NaN);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location for latitude > 90', async () => {
      const result = await detectRegion(91, 77.5946);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location for latitude < -90', async () => {
      const result = await detectRegion(-90.1, 77.5946);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location for longitude > 180', async () => {
      const result = await detectRegion(12.9716, 180.1);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unresolved_location for longitude < -180', async () => {
      const result = await detectRegion(12.9716, -181);
      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_location',
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ─── detectRegion — resolved case ──────────────────────────────────────

  describe('detectRegion() — resolved (Req 29.2)', () => {
    it('returns resolved with region details when a match is found', async () => {
      const mockRegion = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Bangalore Urban District',
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(12.9716, 77.5946);

      expect(result).toEqual({
        regionId: '550e8400-e29b-41d4-a716-446655440000',
        regionName: 'Bangalore Urban District',
        status: 'resolved',
      });
    });

    it('passes longitude as $1 and latitude as $2 to ST_MakePoint', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'region-1', name: 'Test Region' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      await detectRegion(12.9716, 77.5946);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ST_MakePoint($1, $2)'),
        [77.5946, 12.9716] // lng first, lat second (X, Y order)
      );
    });

    it('only queries active regions', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'region-1', name: 'Active Region' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      await detectRegion(12.9716, 77.5946);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'active'"),
        expect.any(Array)
      );
    });

    it('uses ST_Contains for boundary containment check', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'region-1', name: 'Test Region' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      await detectRegion(12.9716, 77.5946);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ST_Contains'),
        expect.any(Array)
      );
    });

    it('uses SRID 4326 (WGS 84) for the point', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'region-1', name: 'Test Region' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      await detectRegion(12.9716, 77.5946);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('4326'),
        expect.any(Array)
      );
    });

    it('limits query to 1 result', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'region-1', name: 'Test Region' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      await detectRegion(12.9716, 77.5946);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 1'),
        expect.any(Array)
      );
    });
  });

  // ─── detectRegion — unresolved_region case ─────────────────────────────

  describe('detectRegion() — unresolved_region (Req 29.3)', () => {
    it('returns unresolved_region when no matching region is found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(0.0, 0.0);

      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_region',
      });
    });

    it('returns unresolved_region for coordinates in ocean (no defined region)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(45.0, -30.0);

      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_region',
      });
    });
  });

  // ─── detectRegion — error handling ─────────────────────────────────────

  describe('detectRegion() — error handling', () => {
    it('returns unresolved_region on database connection error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await detectRegion(12.9716, 77.5946);

      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_region',
      });
    });

    it('returns unresolved_region on query timeout (Req 29.1 — 2s limit)', async () => {
      mockQuery.mockRejectedValueOnce(
        new Error('canceling statement due to statement timeout')
      );

      const result = await detectRegion(12.9716, 77.5946);

      expect(result).toEqual({
        regionId: null,
        regionName: null,
        status: 'unresolved_region',
      });
    });

    it('never throws — always returns a result', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Unexpected database failure'));

      await expect(detectRegion(12.9716, 77.5946)).resolves.not.toThrow();
    });

    it('returns unresolved_region on generic error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('unknown error'));

      const result = await detectRegion(12.9716, 77.5946);

      expect(result.status).toBe('unresolved_region');
      expect(result.regionId).toBeNull();
      expect(result.regionName).toBeNull();
    });
  });

  // ─── detectRegion — boundary coordinate values ─────────────────────────

  describe('detectRegion() — boundary coordinate values', () => {
    it('accepts latitude exactly at 90 (North Pole)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(90, 0);

      expect(mockQuery).toHaveBeenCalled();
      expect(result.status).not.toBe('unresolved_location');
    });

    it('accepts latitude exactly at -90 (South Pole)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(-90, 0);

      expect(mockQuery).toHaveBeenCalled();
      expect(result.status).not.toBe('unresolved_location');
    });

    it('accepts longitude exactly at 180 (International Date Line)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(0, 180);

      expect(mockQuery).toHaveBeenCalled();
      expect(result.status).not.toBe('unresolved_location');
    });

    it('accepts longitude exactly at -180', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(0, -180);

      expect(mockQuery).toHaveBeenCalled();
      expect(result.status).not.toBe('unresolved_location');
    });

    it('accepts (0, 0) as valid coordinates', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      const result = await detectRegion(0, 0);

      expect(mockQuery).toHaveBeenCalled();
      expect(result.status).not.toBe('unresolved_location');
    });
  });
});
