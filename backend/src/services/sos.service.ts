/**
 * SOS Service for MeshSOS Backend.
 *
 * Business logic for creating, retrieving, updating, and managing SOS incidents.
 * Enforces state machine transitions and records lifecycle events.
 */

import { query, getClient } from '../db/index.js';
import { isValidTransition } from '@meshsos/shared';
import type { SOSStatus, EmergencyType } from '../../../shared/src/types/enums.js';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CreateSOSInput {
  id: string;
  emergencyType: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationMethod: 'live' | 'lastKnown' | null;
  locationTimestamp: string | null;
  timestamp: string;
  peopleCount?: number | null;
  situationType?: string | null;
  description?: string | null;
  userId?: string | null;
  userSessionId?: string | null;
}

export interface UpdateSOSInput {
  peopleCount?: number | null;
  situationType?: string | null;
  description?: string | null;
}

export interface SOSIncidentRow {
  id: string;
  user_session_id: string | null;
  user_id: string | null;
  emergency_type: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  location_method: string | null;
  location_timestamp: string | null;
  people_count: number | null;
  situation_type: string | null;
  description: string | null;
  priority_score: number;
  priority_band: string;
  status: SOSStatus;
  region_id: string | null;
  assigned_responder_id: string | null;
  disaster_event_id: string | null;
  duplicate_flag: boolean;
  duplicate_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface SOSEventRow {
  id: string;
  sos_id: string;
  event_type: string;
  actor_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

// â”€â”€â”€ Service Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Create a new SOS incident with an initial 'delivered' status.
 * Records an initial lifecycle event for the state.
 * Uses a transaction to ensure atomicity.
 */
export async function createSOS(input: CreateSOSInput): Promise<SOSIncidentRow> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Build the PostGIS point if coordinates are available
    const locationExpr =
      input.latitude != null && input.longitude != null
        ? `ST_SetSRID(ST_MakePoint($6, $5), 4326)`
        : null;

    const insertSQL = `
      INSERT INTO sos_incidents (
        id, user_session_id, user_id, emergency_type,
        location, accuracy, location_method, location_timestamp,
        people_count, situation_type, description,
        status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        ${locationExpr ?? 'NULL'}, $7, $8, $9,
        $10, $11, $12,
        'delivered', $13, NOW()
      )
      RETURNING
        id, user_session_id, user_id, emergency_type,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        accuracy, location_method, location_timestamp,
        people_count, situation_type, description,
        priority_score, priority_band, status,
        region_id, assigned_responder_id, disaster_event_id,
        duplicate_flag, duplicate_of, created_at, updated_at
    `;

    const params = [
      input.id,                                    // $1
      input.userSessionId ?? null,                 // $2
      input.userId ?? null,                        // $3
      input.emergencyType,                         // $4
      input.latitude,                              // $5 (used in ST_MakePoint)
      input.longitude,                             // $6 (used in ST_MakePoint)
      input.accuracy,                              // $7
      input.locationMethod ?? null,                // $8
      input.locationTimestamp ?? null,             // $9
      input.peopleCount ?? null,                   // $10
      input.situationType ?? null,                 // $11
      input.description ?? null,                   // $12
      input.timestamp,                             // $13
    ];

    const result = await client.query<SOSIncidentRow>(insertSQL, params);
    const incident = result.rows[0];

    // Record initial lifecycle event
    await client.query(
      `INSERT INTO sos_events (sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp)
       VALUES ($1, 'state_transition', $2, NULL, 'delivered', $3, NOW())`,
      [
        input.id,
        input.userId ?? null,
        JSON.stringify({ source: 'sos_creation', emergencyType: input.emergencyType }),
      ]
    );

    await client.query('COMMIT');
    return incident;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieve an SOS incident by ID.
 */
export async function getSOSById(sosId: string): Promise<SOSIncidentRow | null> {
  const result = await query<SOSIncidentRow>(
    `SELECT
      id, user_session_id, user_id, emergency_type,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      accuracy, location_method, location_timestamp,
      people_count, situation_type, description,
      priority_score, priority_band, status,
      region_id, assigned_responder_id, disaster_event_id,
      duplicate_flag, duplicate_of, created_at, updated_at
    FROM sos_incidents
    WHERE id = $1`,
    [sosId]
  );
  return result.rows[0] ?? null;
}

/**
 * Update optional additional information on an SOS incident.
 * Records an update event in the timeline.
 */
export async function updateSOS(
  sosId: string,
  input: UpdateSOSInput,
  actorId: string | null
): Promise<SOSIncidentRow | null> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Build dynamic SET clauses for provided fields
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.peopleCount !== undefined) {
      setClauses.push(`people_count = $${paramIndex++}`);
      values.push(input.peopleCount);
    }
    if (input.situationType !== undefined) {
      setClauses.push(`situation_type = $${paramIndex++}`);
      values.push(input.situationType);
    }
    if (input.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }

    // If nothing to update, just return current state
    if (values.length === 0) {
      await client.query('ROLLBACK');
      return getSOSById(sosId);
    }

    values.push(sosId); // final param for WHERE clause
    const updateSQL = `
      UPDATE sos_incidents
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING
        id, user_session_id, user_id, emergency_type,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        accuracy, location_method, location_timestamp,
        people_count, situation_type, description,
        priority_score, priority_band, status,
        region_id, assigned_responder_id, disaster_event_id,
        duplicate_flag, duplicate_of, created_at, updated_at
    `;

    const result = await client.query<SOSIncidentRow>(updateSQL, values);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // Record update event
    await client.query(
      `INSERT INTO sos_events (sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp)
       VALUES ($1, 'info_updated', $2, NULL, NULL, $3, NOW())`,
      [
        sosId,
        actorId,
        JSON.stringify({ updatedFields: Object.keys(input).filter(k => (input as Record<string, unknown>)[k] !== undefined) }),
      ]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get the event timeline for an SOS, ordered chronologically (ASC).
 */
export async function getSOSTimeline(sosId: string): Promise<SOSEventRow[]> {
  const result = await query<SOSEventRow>(
    `SELECT id, sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp
     FROM sos_events
     WHERE sos_id = $1
     ORDER BY timestamp ASC`,
    [sosId]
  );
  return result.rows;
}

/**
 * Get a user's SOS history, ordered by most recent first.
 */
export async function getSOSHistory(userId: string): Promise<SOSIncidentRow[]> {
  const result = await query<SOSIncidentRow>(
    `SELECT
      id, user_session_id, user_id, emergency_type,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      accuracy, location_method, location_timestamp,
      people_count, situation_type, description,
      priority_score, priority_band, status,
      region_id, assigned_responder_id, disaster_event_id,
      duplicate_flag, duplicate_of, created_at, updated_at
    FROM sos_incidents
    WHERE user_id = $1
    ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Acknowledge an SOS incident (transition from 'delivered' to 'acknowledged').
 * Validates the state transition and returns 409-style error if invalid.
 */
export async function acknowledgeSOS(
  sosId: string,
  actorId: string
): Promise<{ success: true; incident: SOSIncidentRow } | { success: false; error: string; statusCode: number }> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the row for update to prevent race conditions
    const currentResult = await client.query<{ status: SOSStatus }>(
      `SELECT status FROM sos_incidents WHERE id = $1 FOR UPDATE`,
      [sosId]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'SOS incident not found', statusCode: 404 };
    }

    const currentStatus = currentResult.rows[0].status;
    const targetStatus: SOSStatus = 'acknowledged';

    if (!isValidTransition(currentStatus, targetStatus)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: `Invalid state transition from '${currentStatus}' to '${targetStatus}'`,
        statusCode: 409,
      };
    }

    // Perform the transition
    const updateResult = await client.query<SOSIncidentRow>(
      `UPDATE sos_incidents
       SET status = 'acknowledged', updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, user_session_id, user_id, emergency_type,
         ST_Y(location::geometry) as latitude,
         ST_X(location::geometry) as longitude,
         accuracy, location_method, location_timestamp,
         people_count, situation_type, description,
         priority_score, priority_band, status,
         region_id, assigned_responder_id, disaster_event_id,
         duplicate_flag, duplicate_of, created_at, updated_at`,
      [sosId]
    );

    // Record state transition event
    await client.query(
      `INSERT INTO sos_events (sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp)
       VALUES ($1, 'state_transition', $2, $3, $4, $5, NOW())`,
      [
        sosId,
        actorId,
        currentStatus,
        targetStatus,
        JSON.stringify({ action: 'acknowledge' }),
      ]
    );

    await client.query('COMMIT');
    return { success: true, incident: updateResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
