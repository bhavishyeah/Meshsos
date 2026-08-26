/**
 * Auto-Dispatch Service for MeshSOS Backend.
 *
 * Automatically routes SOS incidents to the nearest active station
 * based on emergency type and geographic proximity using PostGIS.
 *
 * Station type mapping:
 *   - 'police'          → station type 'police'
 *   - 'medical'         → station type 'hospital'
 *   - 'food'            → station type 'relief'
 *   - 'childrenElderly' → station type 'hospital' OR 'relief' (nearest of either)
 */

import { query } from '../db/index.js';
import type { EmergencyType } from '../../../shared/src/types/enums.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StationMatch {
  id: string;
  name: string;
  type: string;
  distanceMeters: number;
}

// ─── Emergency Type → Station Type Mapping ──────────────────────────────────

/**
 * Maps emergency types to the station types that can handle them.
 */
function getStationTypesForEmergency(emergencyType: EmergencyType): string[] {
  switch (emergencyType) {
    case 'police':
      return ['police'];
    case 'medical':
      return ['hospital'];
    case 'food':
      return ['relief'];
    case 'childrenElderly':
      return ['hospital', 'relief'];
  }
}

// ─── Find Nearest Station ───────────────────────────────────────────────────

/**
 * Finds the nearest active station matching the emergency type using PostGIS distance.
 *
 * @param emergencyType - The type of emergency
 * @param latitude - SOS latitude (WGS84)
 * @param longitude - SOS longitude (WGS84)
 * @returns The nearest matching station or null if none found
 */
export async function findNearestStation(
  emergencyType: EmergencyType,
  latitude: number,
  longitude: number,
): Promise<StationMatch | null> {
  const stationTypes = getStationTypesForEmergency(emergencyType);

  // Build dynamic IN clause for station types
  const typePlaceholders = stationTypes.map((_, i) => `$${i + 3}`).join(', ');

  const sql = `
    SELECT id, name, type,
      ST_Distance(
        location::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) as distance_meters
    FROM stations
    WHERE type IN (${typePlaceholders})
      AND status = 'active'
    ORDER BY distance_meters ASC
    LIMIT 1
  `;

  const params: (string | number)[] = [longitude, latitude, ...stationTypes];

  const result = await query<{
    id: string;
    name: string;
    type: string;
    distance_meters: number;
  }>(sql, params);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    distanceMeters: Number(row.distance_meters),
  };
}
