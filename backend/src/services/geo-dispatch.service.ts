/**
 * Geo Dispatch Service for MeshSOS Backend.
 *
 * Handles region detection, emergency-type responder routing, responder ranking,
 * and dispatch escalation. This module is the core of the intelligent geo-aware
 * dispatch engine.
 */

import { query } from '../db/index.js';
import type { EmergencyType, ResponderStatus } from '../../../shared/src/types/enums.js';

// ─── Region Detection Types ─────────────────────────────────────────────────

export interface RegionDetectionResult {
  regionId: string | null;
  regionName: string | null;
  status: 'resolved' | 'unresolved_region' | 'unresolved_location';
}

interface RegionRow {
  id: string;
  name: string;
}

/** Query timeout for region detection (2 seconds) per Requirement 29.1 */
export const REGION_QUERY_TIMEOUT_MS = 2000;

// ─── Coordinate Validation ──────────────────────────────────────────────────

/**
 * Checks whether latitude and longitude values are valid GPS coordinates.
 * - lat must be a finite number in [-90, 90]
 * - lng must be a finite number in [-180, 180]
 */
export function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return false;
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return false;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (lat < -90 || lat > 90) {
    return false;
  }
  if (lng < -180 || lng > 180) {
    return false;
  }
  return true;
}

// ─── Region Detection ───────────────────────────────────────────────────────

/**
 * Detects the region containing the given GPS coordinates.
 *
 * 1. If lat or lng is null/undefined/NaN/out-of-range → unresolved_location (Req 29.4)
 * 2. Queries active regions using PostGIS ST_Contains with a 2s timeout (Req 29.1)
 * 3. If a matching region is found → resolved with region details (Req 29.2)
 * 4. If no region matches → unresolved_region (Req 29.3)
 *
 * Note: ST_MakePoint takes (longitude, latitude) — X, Y order.
 */
export async function detectRegion(
  lat: number | null,
  lng: number | null
): Promise<RegionDetectionResult> {
  // Handle missing or invalid GPS coordinates → unresolved_location (Req 29.4)
  if (!isValidCoordinate(lat, lng)) {
    return {
      regionId: null,
      regionName: null,
      status: 'unresolved_location',
    };
  }

  try {
    // Query active regions using ST_Contains with SRID 4326
    // Note: ST_MakePoint(x, y) = ST_MakePoint(lng, lat) in geography
    const result = await query<RegionRow>(
      `SELECT id, name FROM regions
       WHERE status = 'active'
         AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       LIMIT 1`,
      [lng, lat]
    );

    if (result.rows.length > 0) {
      // Region found → resolved (Req 29.2)
      const region = result.rows[0];
      return {
        regionId: region.id,
        regionName: region.name,
        status: 'resolved',
      };
    }

    // No region contains these coordinates → unresolved_region (Req 29.3)
    return {
      regionId: null,
      regionName: null,
      status: 'unresolved_region',
    };
  } catch (error) {
    // On query timeout or database error, treat as unresolved_region
    // so the incident still proceeds to the dispatch queue for manual review
    return {
      regionId: null,
      regionName: null,
      status: 'unresolved_region',
    };
  }
}

// ─── Responder Pool Types ───────────────────────────────────────────────────

/**
 * Responder types stored in the database `responders.type` column.
 */
export type ResponderType = 'police' | 'medical' | 'rescue' | 'relief' | 'social';

/**
 * A responder record as returned from the database query.
 */
export interface Responder {
  id: string;
  user_id: string;
  name: string | null;
  organization: string | null;
  station_id: string | null;
  region_id: string | null;
  type: ResponderType;
  latitude: number | null;
  longitude: number | null;
  location_updated_at: string | null;
  status: ResponderStatus;
  current_incident_id: string | null;
  vehicle: string | null;
  capabilities: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Emergency-Type Routing Map ─────────────────────────────────────────────

/**
 * Maps each emergency type to the responder types that should be included
 * in the candidate pool for dispatch.
 *
 * - Police/Rescue → police officers, rescue teams (disaster response)
 * - Medical → ambulances, medical responders, hospitals
 * - Food/Water → relief teams, local administration, distribution centers
 * - Children/Elderly → social-response teams, police, medical services
 */
export const EMERGENCY_TYPE_ROUTING: Record<EmergencyType, ResponderType[]> = {
  police: ['police', 'rescue'],
  medical: ['medical'],
  food: ['relief'],
  childrenElderly: ['social', 'police', 'medical'],
};

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Get the pool of available responders for a given region and emergency type.
 *
 * This function:
 * 1. Looks up the responder types applicable to the emergency type from EMERGENCY_TYPE_ROUTING
 * 2. Queries the responders table for responders whose station is in the given region,
 *    whose type matches one of the applicable types, and whose status is not 'busy' or 'offline'
 * 3. Returns the list of candidate responders
 *
 * @param regionId - The UUID of the region to search within
 * @param emergencyType - The type of emergency to route
 * @returns Array of candidate responders matching criteria
 */
export async function getResponderPool(
  regionId: string,
  emergencyType: EmergencyType
): Promise<Responder[]> {
  const responderTypes = EMERGENCY_TYPE_ROUTING[emergencyType];

  if (!responderTypes || responderTypes.length === 0) {
    return [];
  }

  // Excluded statuses: busy and offline responders are not available for dispatch
  const excludedStatuses = ['busy', 'offline'];

  // Build parameterized placeholders:
  // $1 = regionId
  // $2, $3 = excluded statuses ('busy', 'offline')
  // $4, $5, ... = responder types for the emergency type
  const excludedPlaceholders = excludedStatuses.map((_, i) => `$${i + 2}`).join(', ');
  const typeStartIndex = 2 + excludedStatuses.length;
  const typePlaceholders = responderTypes.map((_, i) => `$${typeStartIndex + i}`).join(', ');

  const sql = `
    SELECT
      r.id,
      r.user_id,
      u.name,
      r.organization,
      r.station_id,
      s.region_id,
      r.type,
      ST_Y(r.current_location::geometry) as latitude,
      ST_X(r.current_location::geometry) as longitude,
      r.location_updated_at,
      r.status,
      r.current_incident_id,
      r.vehicle,
      r.capabilities,
      r.created_at,
      r.updated_at
    FROM responders r
    INNER JOIN stations s ON r.station_id = s.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE s.region_id = $1
      AND r.status NOT IN (${excludedPlaceholders})
      AND r.type IN (${typePlaceholders})
  `;

  const params = [
    regionId,
    ...excludedStatuses,
    ...responderTypes,
  ];

  const result = await query<Responder>(sql, params);
  return result.rows;
}

// ─── Ranking Types ──────────────────────────────────────────────────────────

export interface RankingConfig {
  stalenessThresholdMs?: number; // default 5 * 60 * 1000 (5 min)
  maxResults?: number;           // default 10
  weights?: {
    distance: number;   // default 0.40
    typeMatch: number;  // default 0.25
    freshness: number;  // default 0.20
    jurisdiction: number; // default 0.15
  };
}

export interface RankedResponderResult {
  responderId: string;
  name: string;
  distanceKm: number;
  status: ResponderStatus;
  locationFreshness: number; // seconds since last update
  suitabilityScore: number;
  isFresh: boolean;
}

// ─── Haversine Distance ─────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

/**
 * Calculate the great-circle distance between two points on Earth
 * using the Haversine formula.
 *
 * @param lat1 - Latitude of point 1 in degrees
 * @param lng1 - Longitude of point 1 in degrees
 * @param lat2 - Latitude of point 2 in degrees
 * @param lng2 - Longitude of point 2 in degrees
 * @returns Distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRadians = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

// ─── Emergency Type Match Logic ─────────────────────────────────────────────

/**
 * Determines whether a responder's type is a primary match for the given
 * emergency type according to the EMERGENCY_TYPE_ROUTING map.
 */
function isTypeMatch(responderType: ResponderType, emergencyType: EmergencyType): boolean {
  const matchingTypes = EMERGENCY_TYPE_ROUTING[emergencyType];
  return matchingTypes ? matchingTypes.includes(responderType) : false;
}

// ─── Responder Ranking Algorithm ────────────────────────────────────────────

const DEFAULT_STALENESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_WEIGHTS = {
  distance: 0.40,
  typeMatch: 0.25,
  freshness: 0.20,
  jurisdiction: 0.15,
};

/**
 * Rank a list of candidate responders for dispatch suitability.
 *
 * Algorithm:
 * 1. Filter out candidates with status 'busy' or 'offline' (defensive)
 * 2. For each remaining candidate:
 *    a. Calculate freshness = (Date.now() - location_updated_at) in seconds
 *    b. Flag as stale if freshness > stalenessThreshold
 *    c. Calculate Haversine distance in km
 *    d. Calculate score components:
 *       - Distance score: 1 / (1 + distanceKm) * weight (closer = higher)
 *       - Type match score: 1.0 if matches, else 0.5 * weight
 *       - Freshness score: (1 - freshness/stalenessThreshold) clamped [0,1] * weight; stale = 0
 *       - Jurisdiction: 1.0 if same region, else 0.5 * weight
 * 3. Total score = sum of weighted components
 * 4. Sort by score descending; break ties by most recent location_updated_at
 * 5. Return top maxResults
 *
 * @param candidates - Array of responders to rank
 * @param incidentLat - Latitude of the incident
 * @param incidentLng - Longitude of the incident
 * @param emergencyType - The emergency type for type-match scoring
 * @param regionId - The region ID for jurisdiction match (null = no jurisdiction bonus)
 * @param config - Optional configuration overrides
 * @returns Sorted array of ranked responder results
 *
 * Requirements: 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 32.1, 32.2
 */
export function rankResponders(
  candidates: Responder[],
  incidentLat: number,
  incidentLng: number,
  emergencyType: EmergencyType,
  regionId: string | null,
  config?: RankingConfig
): RankedResponderResult[] {
  const stalenessThresholdMs = config?.stalenessThresholdMs ?? DEFAULT_STALENESS_THRESHOLD_MS;
  const maxResults = config?.maxResults ?? DEFAULT_MAX_RESULTS;
  const weights = config?.weights ?? DEFAULT_WEIGHTS;
  const stalenessThresholdSec = stalenessThresholdMs / 1000;

  const now = Date.now();

  // Step 1: Filter out Busy/Offline responders (defensive)
  const eligible = candidates.filter(
    (r) => r.status !== 'busy' && r.status !== 'offline'
  );

  // Step 2: Score each remaining candidate
  const scored = eligible.map((candidate) => {
    // 2a. Calculate freshness in seconds
    const locationUpdatedAt = candidate.location_updated_at
      ? new Date(candidate.location_updated_at).getTime()
      : 0;
    const freshnessSec = locationUpdatedAt > 0
      ? (now - locationUpdatedAt) / 1000
      : stalenessThresholdSec + 1; // No location timestamp → treat as stale

    // 2b. Flag as stale.
    // locationFreshness is reported rounded to whole seconds, so classify from
    // that same rounded value. Comparing the unrounded value against the
    // threshold would make isFresh disagree with the reported freshness for
    // ages in the sub-second window just above the threshold
    // (e.g. 300.4s reports locationFreshness 300 but would flag isFresh=false).
    const locationFreshnessSec = Math.round(freshnessSec);
    const isFresh = locationFreshnessSec <= stalenessThresholdSec;

    // 2c. Calculate Haversine distance
    const distanceKm =
      candidate.latitude !== null && candidate.longitude !== null
        ? haversineDistance(incidentLat, incidentLng, candidate.latitude, candidate.longitude)
        : Infinity;

    // 2d. Calculate score components

    // Distance score: 1 / (1 + distanceKm) * weight — closer = higher
    const distanceScore = distanceKm === Infinity
      ? 0
      : (1 / (1 + distanceKm)) * weights.distance;

    // Type match score: 1.0 * weight if matches, else 0.5 * weight
    const typeMatchScore = isTypeMatch(candidate.type, emergencyType)
      ? 1.0 * weights.typeMatch
      : 0.5 * weights.typeMatch;

    // Freshness score: (1 - freshness/threshold) clamped [0,1] * weight; stale = 0
    let freshnessScore: number;
    if (!isFresh) {
      freshnessScore = 0;
    } else {
      const rawFreshness = 1 - freshnessSec / stalenessThresholdSec;
      freshnessScore = Math.max(0, Math.min(1, rawFreshness)) * weights.freshness;
    }

    // Jurisdiction score: 1.0 * weight if same region, else 0.5 * weight
    let jurisdictionScore: number;
    if (regionId === null) {
      // No region to compare — give partial score
      jurisdictionScore = 0.5 * weights.jurisdiction;
    } else {
      jurisdictionScore = candidate.region_id === regionId
        ? 1.0 * weights.jurisdiction
        : 0.5 * weights.jurisdiction;
    }

    // Step 3: Total score
    const suitabilityScore = distanceScore + typeMatchScore + freshnessScore + jurisdictionScore;

    return {
      responderId: candidate.id,
      name: candidate.name ?? candidate.organization ?? 'Unknown',
      distanceKm: distanceKm === Infinity ? -1 : Math.round(distanceKm * 100) / 100,
      status: candidate.status,
      locationFreshness: locationFreshnessSec,
      suitabilityScore: Math.round(suitabilityScore * 10000) / 10000, // 4 decimal places
      isFresh,
      _locationUpdatedAt: locationUpdatedAt, // internal, for tie-breaking sort
    };
  });

  // Step 4: Sort by score descending, break ties by most recent location update
  scored.sort((a, b) => {
    if (b.suitabilityScore !== a.suitabilityScore) {
      return b.suitabilityScore - a.suitabilityScore;
    }
    // Tie-break: most recent location update first
    return b._locationUpdatedAt - a._locationUpdatedAt;
  });

  // Step 5: Return top maxResults, removing internal sort field
  return scored.slice(0, maxResults).map(({ _locationUpdatedAt, ...result }) => result);
}
