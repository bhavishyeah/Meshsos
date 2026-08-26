/**
 * SOS Deduplication Service for MeshSOS Backend.
 *
 * Detects potential duplicate SOS submissions based on device/session ID,
 * location proximity, timestamp proximity, and emergency category.
 * Flags duplicates for dispatcher review — never auto-discards.
 *
 * Requirements: 34.1, 34.2
 */

import { query } from '../db/index.js';
import { haversineDistance } from './geo-dispatch.service.js';
import type { EmergencyType } from '../../../shared/src/types/enums.js';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Time window to search for potential duplicates (30 minutes) */
export const DUPLICATE_TIME_WINDOW_MS = 30 * 60 * 1000;

/** Location proximity threshold for high-confidence duplicate detection (500 meters) */
export const LOCATION_PROXIMITY_THRESHOLD_KM = 0.5;

/** Location proximity threshold for cross-device medium-confidence detection (100 meters) */
export const LOCATION_CLOSE_PROXIMITY_THRESHOLD_KM = 0.1;

/** Timestamp proximity threshold for high-confidence duplicate detection (5 minutes) */
export const TIMESTAMP_PROXIMITY_THRESHOLD_MS = 5 * 60 * 1000;

/** Timestamp proximity threshold for cross-device medium-confidence detection (1 minute) */
export const TIMESTAMP_CLOSE_PROXIMITY_THRESHOLD_MS = 1 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeduplicationInput {
  sosId: string;
  userSessionId: string | null;
  userId: string | null;
  emergencyType: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  duplicateOf: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface RecentSOSRow {
  id: string;
  user_session_id: string | null;
  user_id: string | null;
  emergency_type: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Check whether a new SOS is a potential duplicate of an existing recent SOS.
 *
 * Queries recent SOS records (last 30 minutes) and evaluates similarity:
 * - Same device/session ID (if available) — high confidence
 * - Same emergency type — required for any duplicate detection
 * - Location proximity: within 500 meters (Haversine) — increases confidence
 * - Timestamp proximity: within 5 minutes — increases confidence
 *
 * Deduplication scoring:
 * - Same session + same type + within 5 min → high confidence
 * - Same session + same type + same location → high confidence
 * - Same user + same type + within 5 min + within 500m → medium confidence
 * - Same type + within 1 min + within 100m → medium confidence (different device)
 *
 * Never auto-discards: the SOS is still saved, just flagged.
 *
 * @param input - The new SOS to check for duplicates
 * @returns DeduplicationResult indicating whether a duplicate was detected
 */
export async function checkDuplicate(input: DeduplicationInput): Promise<DeduplicationResult> {
  const noMatch: DeduplicationResult = {
    isDuplicate: false,
    duplicateOf: null,
    confidence: 'low',
    reasons: [],
  };

  // Query recent SOS records within the 30-minute time window, excluding the current SOS itself
  const windowStart = new Date(input.createdAt.getTime() - DUPLICATE_TIME_WINDOW_MS);

  const result = await query<RecentSOSRow>(
    `SELECT
      id,
      user_session_id,
      user_id,
      emergency_type,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      created_at
    FROM sos_incidents
    WHERE id != $1
      AND created_at >= $2
      AND created_at <= $3
      AND emergency_type = $4
    ORDER BY created_at DESC`,
    [input.sosId, windowStart.toISOString(), input.createdAt.toISOString(), input.emergencyType]
  );

  if (result.rows.length === 0) {
    return noMatch;
  }

  // Evaluate each candidate for duplicate similarity
  let bestMatch: DeduplicationResult = noMatch;

  for (const candidate of result.rows) {
    const reasons: string[] = [];
    let confidence: 'high' | 'medium' | 'low' = 'low';

    // Emergency type already matches (filtered in query)
    reasons.push('same_emergency_type');

    // Check session match
    const sameSession =
      input.userSessionId !== null &&
      candidate.user_session_id !== null &&
      input.userSessionId === candidate.user_session_id;

    if (sameSession) {
      reasons.push('same_session');
    }

    // Check user match
    const sameUser =
      input.userId !== null &&
      candidate.user_id !== null &&
      input.userId === candidate.user_id;

    if (sameUser) {
      reasons.push('same_user');
    }

    // Check timestamp proximity
    const timeDiffMs = Math.abs(
      input.createdAt.getTime() - new Date(candidate.created_at).getTime()
    );
    const withinFiveMin = timeDiffMs <= TIMESTAMP_PROXIMITY_THRESHOLD_MS;
    const withinOneMin = timeDiffMs <= TIMESTAMP_CLOSE_PROXIMITY_THRESHOLD_MS;

    if (withinFiveMin) {
      reasons.push('within_5_minutes');
    }
    if (withinOneMin) {
      reasons.push('within_1_minute');
    }

    // Check location proximity
    let withinLocation = false;
    let withinCloseLocation = false;

    if (
      input.latitude !== null &&
      input.longitude !== null &&
      candidate.latitude !== null &&
      candidate.longitude !== null
    ) {
      const distanceKm = haversineDistance(
        input.latitude,
        input.longitude,
        candidate.latitude,
        candidate.longitude
      );

      if (distanceKm <= LOCATION_CLOSE_PROXIMITY_THRESHOLD_KM) {
        withinCloseLocation = true;
        withinLocation = true;
        reasons.push('within_100_meters');
      } else if (distanceKm <= LOCATION_PROXIMITY_THRESHOLD_KM) {
        withinLocation = true;
        reasons.push('within_500_meters');
      }
    }

    // Apply deduplication scoring rules
    // Rule 1: Same session + same type + within 5 min → high confidence
    if (sameSession && withinFiveMin) {
      confidence = 'high';
    }
    // Rule 2: Same session + same type + same location → high confidence
    else if (sameSession && withinLocation) {
      confidence = 'high';
    }
    // Rule 3: Same user + same type + within 5 min + within 500m → medium confidence
    else if (sameUser && withinFiveMin && withinLocation) {
      confidence = 'medium';
    }
    // Rule 4: Same type + within 1 min + within 100m → medium confidence (different device)
    else if (withinOneMin && withinCloseLocation) {
      confidence = 'medium';
    }

    // Only flag as duplicate if confidence is medium or high
    if (confidence !== 'low') {
      // Keep the highest confidence match
      if (
        bestMatch.confidence === 'low' ||
        (bestMatch.confidence === 'medium' && confidence === 'high')
      ) {
        bestMatch = {
          isDuplicate: true,
          duplicateOf: candidate.id,
          confidence,
          reasons,
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Flag an SOS incident as a possible duplicate.
 * Updates the duplicate_flag and duplicate_of fields on the incident.
 * The SOS is NOT discarded — it remains available for dispatcher review.
 *
 * @param sosId - The ID of the SOS to flag as duplicate
 * @param duplicateOf - The ID of the suspected original SOS
 */
export async function flagDuplicate(sosId: string, duplicateOf: string): Promise<void> {
  await query(
    `UPDATE sos_incidents SET duplicate_flag = true, duplicate_of = $2 WHERE id = $1`,
    [sosId, duplicateOf]
  );
}
