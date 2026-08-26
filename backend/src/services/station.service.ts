/**
 * Station Service for MeshSOS.
 *
 * CRUD operations for stations (police stations, hospitals, relief centers).
 * Records all changes in the audit trail.
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4
 */

import { query } from '../db/index.js';
import { record } from './audit.service.js';
import type { AuditEventType } from '@meshsos/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StationType = 'police' | 'hospital' | 'relief';

export interface StationInput {
  name: string;
  type: StationType;
  latitude: number;
  longitude: number;
  regionId?: string | null;
  contact?: string | null;
  capacity?: number | null;
  services?: Record<string, unknown> | null;
  officerCount?: number | null;
}

export interface StationUpdateInput {
  name?: string;
  type?: StationType;
  latitude?: number;
  longitude?: number;
  regionId?: string | null;
  contact?: string | null;
  capacity?: number | null;
  services?: Record<string, unknown> | null;
  officerCount?: number | null;
}

export interface StationRecord {
  id: string;
  name: string;
  type: StationType;
  latitude: number;
  longitude: number;
  regionId: string | null;
  contact: string | null;
  capacity: number | null;
  services: Record<string, unknown> | null;
  officerCount: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StationListFilters {
  type?: StationType;
  status?: string;
  regionId?: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates geographic coordinates (Requirement 27.4).
 * Latitude must be between -90 and 90, longitude between -180 and 180.
 */
export function validateCoordinates(latitude: number, longitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    !isNaN(latitude) &&
    !isNaN(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// ─── Row Mapper ─────────────────────────────────────────────────────────────

interface StationRow {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  region_id: string | null;
  contact: string | null;
  capacity: number | null;
  services: Record<string, unknown> | null;
  officer_count: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: StationRow): StationRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as StationType,
    latitude: row.latitude,
    longitude: row.longitude,
    regionId: row.region_id,
    contact: row.contact,
    capacity: row.capacity,
    services: row.services,
    officerCount: row.officer_count,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Creates a new station.
 * Validates coordinates before persisting (Req 27.4).
 * Records a facility:created audit event.
 */
export async function createStation(
  input: StationInput,
  actorId: string
): Promise<StationRecord> {
  if (!validateCoordinates(input.latitude, input.longitude)) {
    throw new StationValidationError(
      'Invalid geographic coordinates: latitude must be between -90 and 90, longitude between -180 and 180'
    );
  }

  const sql = `
    INSERT INTO stations (name, type, location, region_id, contact, capacity, services, officer_count, status)
    VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, 'active')
    RETURNING id, name, type,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      region_id, contact, capacity, services, officer_count, status, created_at, updated_at
  `;

  const params = [
    input.name,
    input.type,
    input.longitude,
    input.latitude,
    input.regionId ?? null,
    input.contact ?? null,
    input.capacity ?? null,
    input.services ? JSON.stringify(input.services) : null,
    input.officerCount ?? null,
  ];

  const result = await query<StationRow>(sql, params);
  const station = mapRow(result.rows[0]);

  // Record audit event
  await record({
    eventType: 'facility:created' as AuditEventType,
    actorId,
    targetEntityId: station.id,
    newState: JSON.stringify({
      name: station.name,
      type: station.type,
      latitude: station.latitude,
      longitude: station.longitude,
      status: station.status,
    }),
    metadata: { facilityType: station.type },
  });

  return station;
}

/**
 * Retrieves a station by ID.
 * Returns null if not found.
 */
export async function getStationById(id: string): Promise<StationRecord | null> {
  const sql = `
    SELECT id, name, type,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      region_id, contact, capacity, services, officer_count, status, created_at, updated_at
    FROM stations
    WHERE id = $1
  `;

  const result = await query<StationRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Lists stations with optional filters.
 */
export async function listStations(
  filters: StationListFilters = {}
): Promise<StationRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.type) {
    conditions.push(`type = $${paramIndex++}`);
    params.push(filters.type);
  }

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.regionId) {
    conditions.push(`region_id = $${paramIndex++}`);
    params.push(filters.regionId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT id, name, type,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      region_id, contact, capacity, services, officer_count, status, created_at, updated_at
    FROM stations
    ${whereClause}
    ORDER BY name ASC
  `;

  const result = await query<StationRow>(sql, params);
  return result.rows.map(mapRow);
}

/**
 * Updates a station.
 * Validates coordinates if provided (Req 27.4).
 * Records a facility:updated audit event with previous and new state.
 */
export async function updateStation(
  id: string,
  input: StationUpdateInput,
  actorId: string
): Promise<StationRecord | null> {
  // Validate coordinates if being updated
  if (input.latitude !== undefined || input.longitude !== undefined) {
    const existing = await getStationById(id);
    if (!existing) return null;

    const lat = input.latitude ?? existing.latitude;
    const lng = input.longitude ?? existing.longitude;

    if (!validateCoordinates(lat, lng)) {
      throw new StationValidationError(
        'Invalid geographic coordinates: latitude must be between -90 and 90, longitude between -180 and 180'
      );
    }
  }

  // Get current state for audit trail
  const current = await getStationById(id);
  if (!current) return null;

  // Build dynamic update
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(input.name);
  }

  if (input.type !== undefined) {
    setClauses.push(`type = $${paramIndex++}`);
    params.push(input.type);
  }

  if (input.latitude !== undefined || input.longitude !== undefined) {
    const lat = input.latitude ?? current.latitude;
    const lng = input.longitude ?? current.longitude;
    setClauses.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex++}, $${paramIndex++}), 4326)`);
    params.push(lng, lat);
  }

  if (input.regionId !== undefined) {
    setClauses.push(`region_id = $${paramIndex++}`);
    params.push(input.regionId);
  }

  if (input.contact !== undefined) {
    setClauses.push(`contact = $${paramIndex++}`);
    params.push(input.contact);
  }

  if (input.capacity !== undefined) {
    setClauses.push(`capacity = $${paramIndex++}`);
    params.push(input.capacity);
  }

  if (input.services !== undefined) {
    setClauses.push(`services = $${paramIndex++}`);
    params.push(input.services ? JSON.stringify(input.services) : null);
  }

  if (input.officerCount !== undefined) {
    setClauses.push(`officer_count = $${paramIndex++}`);
    params.push(input.officerCount);
  }

  if (setClauses.length === 0) {
    return current; // Nothing to update
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(id);

  const sql = `
    UPDATE stations
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, type,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      region_id, contact, capacity, services, officer_count, status, created_at, updated_at
  `;

  const result = await query<StationRow>(sql, params);
  if (result.rows.length === 0) return null;

  const updated = mapRow(result.rows[0]);

  // Record audit event
  await record({
    eventType: 'facility:updated' as AuditEventType,
    actorId,
    targetEntityId: id,
    previousState: JSON.stringify({
      name: current.name,
      type: current.type,
      latitude: current.latitude,
      longitude: current.longitude,
      status: current.status,
    }),
    newState: JSON.stringify({
      name: updated.name,
      type: updated.type,
      latitude: updated.latitude,
      longitude: updated.longitude,
      status: updated.status,
    }),
    metadata: { facilityType: updated.type },
  });

  return updated;
}

/**
 * Deactivates a station by setting status to 'inactive'.
 * Records a facility:deactivated audit event.
 */
export async function deactivateStation(
  id: string,
  actorId: string
): Promise<StationRecord | null> {
  // Get current state for audit trail
  const current = await getStationById(id);
  if (!current) return null;

  if (current.status === 'inactive') {
    return current; // Already inactive
  }

  const sql = `
    UPDATE stations
    SET status = 'inactive', updated_at = NOW()
    WHERE id = $1
    RETURNING id, name, type,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      region_id, contact, capacity, services, officer_count, status, created_at, updated_at
  `;

  const result = await query<StationRow>(sql, [id]);
  if (result.rows.length === 0) return null;

  const deactivated = mapRow(result.rows[0]);

  // Record audit event
  await record({
    eventType: 'facility:deactivated' as AuditEventType,
    actorId,
    targetEntityId: id,
    previousState: JSON.stringify({ status: current.status }),
    newState: JSON.stringify({ status: 'inactive' }),
    metadata: { facilityType: deactivated.type, stationName: deactivated.name },
  });

  return deactivated;
}

// ─── Error Classes ──────────────────────────────────────────────────────────

/**
 * Thrown when station input fails validation (e.g., invalid coordinates).
 */
export class StationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StationValidationError';
  }
}
