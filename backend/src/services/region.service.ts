/**
 * Region Service for MeshSOS.
 *
 * CRUD operations for geographic regions used by the geo-dispatch engine.
 * - createRegion(): Create a new region with a validated GeoJSON polygon boundary
 * - listRegions(): List all regions with boundary as GeoJSON
 * - updateRegion(): Patch region name, boundary, or status
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { query } from '../db/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RegionStatus = 'active' | 'inactive';

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface Region {
  id: string;
  name: string;
  boundary_geojson: string;
  status: RegionStatus;
  created_at: Date;
}

export interface CreateRegionInput {
  name: string;
  boundary: GeoJSONPolygon;
  status?: RegionStatus;
}

export interface UpdateRegionInput {
  name?: string;
  boundary?: GeoJSONPolygon;
  status?: RegionStatus;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates that the boundary is a well-formed GeoJSON Polygon and passes
 * PostGIS ST_IsValid check.
 *
 * Throws an error if the boundary is invalid.
 */
async function validateBoundary(boundary: GeoJSONPolygon): Promise<void> {
  if (!boundary || boundary.type !== 'Polygon') {
    throw new RegionValidationError('Boundary must be a GeoJSON Polygon');
  }

  if (
    !Array.isArray(boundary.coordinates) ||
    boundary.coordinates.length === 0
  ) {
    throw new RegionValidationError('Boundary coordinates must be a non-empty array');
  }

  const ring = boundary.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new RegionValidationError(
      'Polygon ring must have at least 4 coordinate positions (first and last must be identical)'
    );
  }

  // Check that the ring is closed (first and last coordinate match)
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new RegionValidationError('Polygon ring must be closed (first and last coordinates must match)');
  }

  // Validate with PostGIS ST_IsValid
  const geojsonStr = JSON.stringify(boundary);
  const result = await query<{ is_valid: boolean; reason: string | null }>(
    `SELECT
       ST_IsValid(ST_GeomFromGeoJSON($1)) AS is_valid,
       ST_IsValidReason(ST_GeomFromGeoJSON($1)) AS reason`,
    [geojsonStr]
  );

  if (!result.rows[0]?.is_valid) {
    const reason = result.rows[0]?.reason ?? 'Unknown geometry validation error';
    throw new RegionValidationError(`Boundary polygon is not valid: ${reason}`);
  }
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Creates a new region with a validated boundary polygon.
 *
 * Requirement 7.1: POST /api/regions accepting name, boundary (GeoJSON polygon), status
 * Requirement 7.4: Validate boundary forms a valid closed polygon before inserting
 */
export async function createRegion(input: CreateRegionInput): Promise<Region> {
  await validateBoundary(input.boundary);

  const geojsonStr = JSON.stringify(input.boundary);
  const status = input.status ?? 'active';

  const sql = `
    INSERT INTO regions (name, boundary, status)
    VALUES ($1, ST_GeomFromGeoJSON($2), $3)
    RETURNING id, name, ST_AsGeoJSON(boundary) AS boundary_geojson, status, created_at
  `;

  const params = [input.name, geojsonStr, status];
  const result = await query<Region>(sql, params);
  return result.rows[0];
}

/**
 * Lists all regions with boundaries returned as GeoJSON.
 *
 * Requirement 7.2: GET /api/regions returning id, name, status, created_at + boundary
 */
export async function listRegions(): Promise<Region[]> {
  const sql = `
    SELECT id, name, ST_AsGeoJSON(boundary) AS boundary_geojson, status, created_at
    FROM regions
    ORDER BY created_at DESC
  `;

  const result = await query<Region>(sql);
  return result.rows;
}

/**
 * Retrieves a single region by ID.
 */
export async function getRegionById(id: string): Promise<Region | null> {
  const sql = `
    SELECT id, name, ST_AsGeoJSON(boundary) AS boundary_geojson, status, created_at
    FROM regions
    WHERE id = $1
  `;

  const result = await query<Region>(sql, [id]);
  return result.rows[0] ?? null;
}

/**
 * Updates a region's name, boundary, and/or status.
 *
 * Requirement 7.3: PATCH /api/regions/:id allowing updates to name, boundary, status
 * Requirement 7.4: Validate boundary if provided
 */
export async function updateRegion(
  id: string,
  input: UpdateRegionInput
): Promise<Region | null> {
  // Verify region exists
  const existing = await getRegionById(id);
  if (!existing) {
    return null;
  }

  // Validate boundary if provided
  if (input.boundary) {
    await validateBoundary(input.boundary);
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(input.name);
  }

  if (input.boundary !== undefined) {
    setClauses.push(`boundary = ST_GeomFromGeoJSON($${paramIndex++})`);
    params.push(JSON.stringify(input.boundary));
  }

  if (input.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    params.push(input.status);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  params.push(id);
  const sql = `
    UPDATE regions
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, ST_AsGeoJSON(boundary) AS boundary_geojson, status, created_at
  `;

  const result = await query<Region>(sql, params);
  return result.rows[0] ?? null;
}

// ─── Error Classes ──────────────────────────────────────────────────────────

/**
 * Custom error for region boundary validation failures.
 */
export class RegionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegionValidationError';
  }
}
