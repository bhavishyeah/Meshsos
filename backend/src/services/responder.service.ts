/**
 * Responder Service for MeshSOS Backend.
 *
 * Manages responder status, retrieval by ID, and region-based queries.
 * Records status changes in the audit trail and broadcasts via WebSocket.
 *
 * Requirements: 19.1, 19.3
 */

import { query } from '../db/index.js';
import { record } from './audit.service.js';
import { broadcastStatusChange, broadcastLocationUpdate } from '../websocket/index.js';
import type { ResponderStatus, AuditEventType } from '@meshsos/shared';
import type { LocationUpdate } from '../../../shared/src/types/websocket.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ResponderType = 'police' | 'medical' | 'rescue' | 'relief' | 'social';

export interface ResponderRecord {
  id: string;
  userId: string;
  organization: string | null;
  stationId: string | null;
  type: ResponderType;
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: Date | null;
  status: ResponderStatus;
  currentIncidentId: string | null;
  vehicle: string | null;
  capabilities: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Valid Statuses ─────────────────────────────────────────────────────────

export const VALID_RESPONDER_STATUSES: readonly ResponderStatus[] = [
  'available',
  'busy',
  'assigned',
  'enRoute',
  'onScene',
  'offline',
];

/**
 * Validates that a given status string is a valid ResponderStatus.
 */
export function isValidResponderStatus(status: string): status is ResponderStatus {
  return VALID_RESPONDER_STATUSES.includes(status as ResponderStatus);
}

// ─── Row Mapper ─────────────────────────────────────────────────────────────

interface ResponderRow {
  id: string;
  user_id: string;
  organization: string | null;
  station_id: string | null;
  type: string;
  latitude: number | null;
  longitude: number | null;
  location_updated_at: Date | null;
  status: string;
  current_incident_id: string | null;
  vehicle: string | null;
  capabilities: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ResponderRow): ResponderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    organization: row.organization,
    stationId: row.station_id,
    type: row.type as ResponderType,
    latitude: row.latitude,
    longitude: row.longitude,
    locationUpdatedAt: row.location_updated_at ? new Date(row.location_updated_at) : null,
    status: row.status as ResponderStatus,
    currentIncidentId: row.current_incident_id,
    vehicle: row.vehicle,
    capabilities: row.capabilities,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Updates a responder's status.
 * Records the change in the audit trail and broadcasts via WebSocket.
 *
 * Requirement 19.1: Allow setting status to Available, Busy, Assigned, En Route, On Scene, Offline
 * Requirement 19.3: Record every status change with timestamp for audit
 */
export async function updateResponderStatus(
  responderId: string,
  newStatus: ResponderStatus,
  actorId: string
): Promise<ResponderRecord | null> {
  // Validate the new status
  if (!isValidResponderStatus(newStatus)) {
    throw new ResponderValidationError(
      `Invalid responder status: ${newStatus}. Must be one of: ${VALID_RESPONDER_STATUSES.join(', ')}`
    );
  }

  // Get current responder to capture previous state
  const current = await getResponderById(responderId);
  if (!current) {
    return null;
  }

  const previousStatus = current.status;

  // Update status in the database
  const sql = `
    UPDATE responders
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING id, user_id, organization, station_id, type,
      ST_Y(current_location::geometry) AS latitude,
      ST_X(current_location::geometry) AS longitude,
      location_updated_at, status, current_incident_id, vehicle, capabilities,
      created_at, updated_at
  `;

  const result = await query<ResponderRow>(sql, [newStatus, responderId]);
  if (result.rows.length === 0) return null;

  const updated = mapRow(result.rows[0]);

  // Record audit event (Requirement 19.3)
  await record({
    eventType: 'responder:statusChange' as AuditEventType,
    actorId,
    targetEntityId: responderId,
    previousState: JSON.stringify({ status: previousStatus }),
    newState: JSON.stringify({ status: newStatus }),
    metadata: { responderId, previousStatus, newStatus },
  });

  // Broadcast status change via WebSocket
  broadcastStatusChange({
    responderId,
    previousStatus,
    newStatus,
    timestamp: new Date(),
  });

  return updated;
}

/**
 * Retrieves a responder by ID with PostGIS location extraction.
 */
export async function getResponderById(responderId: string): Promise<ResponderRecord | null> {
  const sql = `
    SELECT id, user_id, organization, station_id, type,
      ST_Y(current_location::geometry) AS latitude,
      ST_X(current_location::geometry) AS longitude,
      location_updated_at, status, current_incident_id, vehicle, capabilities,
      created_at, updated_at
    FROM responders
    WHERE id = $1
  `;

  const result = await query<ResponderRow>(sql, [responderId]);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Retrieves all responders belonging to a specific region (via their station's region).
 */
export async function getRespondersByRegion(regionId: string): Promise<ResponderRecord[]> {
  const sql = `
    SELECT r.id, r.user_id, r.organization, r.station_id, r.type,
      ST_Y(r.current_location::geometry) AS latitude,
      ST_X(r.current_location::geometry) AS longitude,
      r.location_updated_at, r.status, r.current_incident_id, r.vehicle, r.capabilities,
      r.created_at, r.updated_at
    FROM responders r
    JOIN stations s ON r.station_id = s.id
    WHERE s.region_id = $1
    ORDER BY r.status ASC, r.updated_at DESC
  `;

  const result = await query<ResponderRow>(sql, [regionId]);
  return result.rows.map(mapRow);
}

// ─── Location Update Throttling ─────────────────────────────────────────────

/** Maximum 1 update per 5 seconds per responder */
export const LOCATION_THROTTLE_MS = 5000;

/** In-memory throttle map: responderId → lastUpdateTimestamp */
export const locationUpdateThrottles = new Map<string, number>();

export interface LocationUpdateResult {
  updated: boolean;
  reason?: 'throttled' | 'invalid_coordinates';
}

/**
 * Persist a responder's location update to the database with throttling.
 * Does NOT broadcast — use updateResponderLocation for the full flow,
 * or call this from the WebSocket handler which broadcasts at the socket level.
 *
 * @param responderId - The responder's ID
 * @param latitude - GPS latitude
 * @param longitude - GPS longitude
 * @param accuracy - GPS accuracy in meters
 * @param now - Optional timestamp override for testing
 * @returns Whether the update was persisted or throttled
 */
export async function persistLocationUpdate(
  responderId: string,
  latitude: number,
  longitude: number,
  accuracy: number,
  now?: number
): Promise<LocationUpdateResult> {
  // Validate coordinates
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { updated: false, reason: 'invalid_coordinates' };
  }

  // Check throttle
  const currentTime = now ?? Date.now();
  const lastUpdate = locationUpdateThrottles.get(responderId) ?? 0;
  if (currentTime - lastUpdate < LOCATION_THROTTLE_MS) {
    return { updated: false, reason: 'throttled' };
  }

  // Persist to database — ST_MakePoint takes (longitude, latitude)
  await query(
    `UPDATE responders
     SET current_location = ST_SetSRID(ST_MakePoint($1, $2), 4326),
         location_updated_at = NOW()
     WHERE id = $3`,
    [longitude, latitude, responderId]
  );

  // Update throttle timestamp
  locationUpdateThrottles.set(responderId, currentTime);

  return { updated: true };
}

/**
 * Update a responder's current location (full flow: persist + broadcast).
 *
 * - Throttles to max 1 update per 5 seconds per responder
 * - Persists to responders table (current_location, location_updated_at)
 * - Broadcasts to command center via WebSocket
 *
 * Requirement 22.1: Transmit location updates (lat, lng, accuracy, timestamp) while app active
 * Requirement 22.2: Store each location update with timestamp for freshness calculation
 *
 * @param responderId - The responder's ID
 * @param latitude - GPS latitude
 * @param longitude - GPS longitude
 * @param accuracy - GPS accuracy in meters
 * @param now - Optional timestamp override for testing
 * @returns Whether the update was persisted or throttled
 */
export async function updateResponderLocation(
  responderId: string,
  latitude: number,
  longitude: number,
  accuracy: number,
  now?: number
): Promise<LocationUpdateResult> {
  const result = await persistLocationUpdate(responderId, latitude, longitude, accuracy, now);

  if (result.updated) {
    const currentTime = now ?? Date.now();
    const locationData: LocationUpdate = {
      responderId,
      latitude,
      longitude,
      accuracy,
      timestamp: new Date(currentTime),
    };
    broadcastLocationUpdate(locationData);
  }

  return result;
}

/**
 * Clear the throttle map. Useful for testing.
 */
export function clearLocationThrottles(): void {
  locationUpdateThrottles.clear();
}

// ─── Error Classes ──────────────────────────────────────────────────────────

/**
 * Thrown when responder input fails validation.
 */
export class ResponderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponderValidationError';
  }
}
