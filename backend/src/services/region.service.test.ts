/**
 * Unit tests for RegionService.
 *
 * Tests CRUD operations with mocked database.
 * Covers: createRegion, listRegions, getRegionById, updateRegion, validation.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import {
  createRegion,
  listRegions,
  getRegionById,
  updateRegion,
  RegionValidationError,
  type CreateRegionInput,
  type UpdateRegionInput,
  type GeoJSONPolygon,
} from './region.service.js';
import { query } from '../db/index.js';

const mockQuery = vi.mocked(query);

// ─── Test Data ──────────────────────────────────────────────────────────────

const REGION_ID = '00000000-0000-0000-0000-000000000001';

const validPolygon: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
};

const sampleRegion = {
  id: REGION_ID,
  name: 'Downtown District',
  boundary_geojson: JSON.stringify(validPolygon),
  status: 'active' as const,
  created_at: new Date('2024-01-01T00:00:00Z'),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('RegionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRegion()', () => {
    it('validates boundary and inserts region', async () => {
      // First call: ST_IsValid validation
      mockQuery.mockResolvedValueOnce({
        rows: [{ is_valid: true, reason: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Second call: INSERT
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const input: CreateRegionInput = {
        name: 'Downtown District',
        boundary: validPolygon,
      };

      const result = await createRegion(input);

      expect(result).toEqual(sampleRegion);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      // Check validation query
      const [validationSql, validationParams] = mockQuery.mock.calls[0];
      expect(validationSql).toContain('ST_IsValid');
      expect(validationParams).toEqual([JSON.stringify(validPolygon)]);

      // Check insert query
      const [insertSql, insertParams] = mockQuery.mock.calls[1];
      expect(insertSql).toContain('INSERT INTO regions');
      expect(insertSql).toContain('ST_GeomFromGeoJSON');
      expect(insertParams).toEqual(['Downtown District', JSON.stringify(validPolygon), 'active']);
    });

    it('uses provided status when specified', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ is_valid: true, reason: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ ...sampleRegion, status: 'inactive' }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const input: CreateRegionInput = {
        name: 'Downtown District',
        boundary: validPolygon,
        status: 'inactive',
      };

      const result = await createRegion(input);

      expect(result.status).toBe('inactive');
      const [, insertParams] = mockQuery.mock.calls[1];
      expect(insertParams![2]).toBe('inactive');
    });

    it('throws RegionValidationError for non-Polygon type', async () => {
      const input: CreateRegionInput = {
        name: 'Bad Region',
        boundary: { type: 'Polygon', coordinates: [] } as GeoJSONPolygon,
      };

      await expect(createRegion(input)).rejects.toThrow(RegionValidationError);
      await expect(createRegion(input)).rejects.toThrow('non-empty array');
    });

    it('throws RegionValidationError for ring with fewer than 4 points', async () => {
      const input: CreateRegionInput = {
        name: 'Bad Region',
        boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
      };

      await expect(createRegion(input)).rejects.toThrow(RegionValidationError);
      await expect(createRegion(input)).rejects.toThrow('at least 4');
    });

    it('throws RegionValidationError for unclosed ring', async () => {
      const input: CreateRegionInput = {
        name: 'Bad Region',
        boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
      };

      await expect(createRegion(input)).rejects.toThrow(RegionValidationError);
      await expect(createRegion(input)).rejects.toThrow('closed');
    });

    it('throws RegionValidationError when ST_IsValid returns false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ is_valid: false, reason: 'Self-intersection' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const input: CreateRegionInput = {
        name: 'Self-intersecting',
        boundary: validPolygon,
      };

      await expect(createRegion(input)).rejects.toThrow(
        new RegionValidationError('Boundary polygon is not valid: Self-intersection')
      );
    });
  });

  describe('listRegions()', () => {
    it('returns all regions with GeoJSON boundaries', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion, { ...sampleRegion, id: '00000000-0000-0000-0000-000000000002', name: 'North District' }],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await listRegions();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Downtown District');
      expect(result[1].name).toBe('North District');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('ST_AsGeoJSON(boundary)');
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('returns empty array when no regions exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await listRegions();
      expect(result).toEqual([]);
    });
  });

  describe('getRegionById()', () => {
    it('returns region when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getRegionById(REGION_ID);

      expect(result).toEqual(sampleRegion);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([REGION_ID]);
    });

    it('returns null when region not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getRegionById('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateRegion()', () => {
    it('updates name only', async () => {
      // First call: getRegionById
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Second call: UPDATE
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...sampleRegion, name: 'Uptown District' }],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await updateRegion(REGION_ID, { name: 'Uptown District' });

      expect(result!.name).toBe('Uptown District');
      const [updateSql, updateParams] = mockQuery.mock.calls[1];
      expect(updateSql).toContain('UPDATE regions');
      expect(updateSql).toContain('name = $1');
      expect(updateParams).toEqual(['Uptown District', REGION_ID]);
    });

    it('updates boundary with validation', async () => {
      const newBoundary: GeoJSONPolygon = {
        type: 'Polygon',
        coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
      };

      // First call: getRegionById
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Second call: ST_IsValid validation
      mockQuery.mockResolvedValueOnce({
        rows: [{ is_valid: true, reason: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Third call: UPDATE
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...sampleRegion, boundary_geojson: JSON.stringify(newBoundary) }],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await updateRegion(REGION_ID, { boundary: newBoundary });

      expect(result!.boundary_geojson).toBe(JSON.stringify(newBoundary));
      const [updateSql] = mockQuery.mock.calls[2];
      expect(updateSql).toContain('ST_GeomFromGeoJSON');
    });

    it('updates status only', async () => {
      // First call: getRegionById
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Second call: UPDATE
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...sampleRegion, status: 'inactive' }],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await updateRegion(REGION_ID, { status: 'inactive' });

      expect(result!.status).toBe('inactive');
    });

    it('returns null when region not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await updateRegion('nonexistent-id', { name: 'Updated' });
      expect(result).toBeNull();
    });

    it('returns existing region when no fields provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await updateRegion(REGION_ID, {});

      expect(result).toEqual(sampleRegion);
      // Only the getRegionById query should have been called
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid boundary on update', async () => {
      // First call: getRegionById
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Second call: ST_IsValid returns false
      mockQuery.mockResolvedValueOnce({
        rows: [{ is_valid: false, reason: 'Ring not closed' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const input: UpdateRegionInput = {
        boundary: validPolygon, // Valid shape but ST_IsValid returns false in mock
      };

      await expect(updateRegion(REGION_ID, input)).rejects.toThrow(RegionValidationError);
    });

    it('updates multiple fields at once', async () => {
      const newBoundary: GeoJSONPolygon = {
        type: 'Polygon',
        coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
      };

      // First call: getRegionById
      mockQuery.mockResolvedValueOnce({
        rows: [sampleRegion],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Second call: ST_IsValid validation
      mockQuery.mockResolvedValueOnce({
        rows: [{ is_valid: true, reason: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Third call: UPDATE
      const updatedRegion = {
        ...sampleRegion,
        name: 'New Name',
        boundary_geojson: JSON.stringify(newBoundary),
        status: 'inactive',
      };
      mockQuery.mockResolvedValueOnce({
        rows: [updatedRegion],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await updateRegion(REGION_ID, {
        name: 'New Name',
        boundary: newBoundary,
        status: 'inactive',
      });

      expect(result!.name).toBe('New Name');
      expect(result!.status).toBe('inactive');

      // Verify the update SQL has all three SET clauses
      const [updateSql, updateParams] = mockQuery.mock.calls[2];
      expect(updateSql).toContain('name = $1');
      expect(updateSql).toContain('ST_GeomFromGeoJSON($2)');
      expect(updateSql).toContain('status = $3');
      expect(updateParams).toEqual(['New Name', JSON.stringify(newBoundary), 'inactive', REGION_ID]);
    });
  });
});
