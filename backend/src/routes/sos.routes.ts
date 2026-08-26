/**
 * SOS Routes for MeshSOS Backend.
 *
 * POST   /api/sos              - Create new SOS (optionalAuthenticate)
 * GET    /api/sos/history      - Get survivor's SOS history (authenticate)
 * GET    /api/sos/:id          - Get SOS details (authenticate)
 * PATCH  /api/sos/:id          - Update SOS additional info (authenticate)
 * GET    /api/sos/:id/timeline - Get SOS event timeline (authenticate)
 * POST   /api/sos/:id/ack      - Acknowledge SOS (authenticate + authorize)
 * GET    /api/sos/:id/dispatch-options - Get ranked responders (authenticate + authorize)
 * POST   /api/sos/:id/enroute  - Mark en route (authenticate + authorize)
 * POST   /api/sos/:id/arrived  - Mark arrived (authenticate + authorize)
 * POST   /api/sos/:id/resolved - Mark resolved (authenticate + authorize)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import {
  createSOS,
  getSOSById,
  updateSOS,
  getSOSTimeline,
  getSOSHistory,
  acknowledgeSOS,
} from '../services/sos.service.js';
import { markEnRoute, markArrived, markResolved } from '../services/workflow.service.js';
import { checkSuspiciousActivity, flagSuspiciousActivity } from '../services/suspicious-activity.service.js';
import { checkDuplicate, flagDuplicate } from '../services/deduplication.service.js';
import { broadcastDispatchAssignment, broadcastStateChange, broadcastStationAlert } from '../websocket/index.js';
import { startEscalation } from '../services/escalation.service.js';
import { isValidTransition } from '@meshsos/shared';
import type { SOSStatus } from '@meshsos/shared';
import { query as dbQuery, getClient } from '../db/index.js';
import { getResponderPool, rankResponders, detectRegion } from '../services/geo-dispatch.service.js';
import { notifySOSStateChange } from '../services/push.service.js';
import { findNearestStation, type StationMatch } from '../services/auto-dispatch.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const createSOSSchema = z.object({
  id: z.string().uuid(),
  emergencyType: z.enum(['police', 'medical', 'food', 'childrenElderly']),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracy: z.number().min(0).nullable(),
  locationMethod: z.enum(['live', 'lastKnown']).nullable(),
  locationTimestamp: z.string().nullable(),
  timestamp: z.string(),
  peopleCount: z.number().int().min(1).nullable().optional(),
  situationType: z.string().max(50).nullable().optional(),
  description: z.string().max(200).nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
});

const updateSOSSchema = z.object({
  peopleCount: z.number().int().min(1).nullable().optional(),
  situationType: z.string().max(50).nullable().optional(),
  description: z.string().max(200).nullable().optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const dispatchBodySchema = z.object({
  responderId: z.string().uuid(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/sos
 * Create a new SOS incident.
 * Uses optionalAuthenticate — SOS creation doesn't require auth (Requirement 37.5).
 */
router.post('/', optionalAuthenticate, async (req: Request, res: Response) => {
  try {
    const parseResult = createSOSSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues,
      });
      return;
    }

    const data = parseResult.data;

    const incident = await createSOS({
      id: data.id,
      emergencyType: data.emergencyType,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      locationMethod: data.locationMethod,
      locationTimestamp: data.locationTimestamp,
      timestamp: data.timestamp,
      peopleCount: data.peopleCount ?? null,
      situationType: data.situationType ?? null,
      description: data.description ?? null,
      userId: req.user?.id ?? null,
      userSessionId: data.sessionId ?? null,
    });

    // Post-creation: suspicious activity check and deduplication (non-blocking)
    // These never prevent the SOS from being created — they only flag for review.
    try {
      const userId = req.user?.id ?? null;
      const sessionId = incident.user_session_id ?? null;

      // Check for suspicious rapid submissions
      const suspiciousResult = await checkSuspiciousActivity(userId, sessionId);
      if (suspiciousResult.isSuspicious && suspiciousResult.reason) {
        await flagSuspiciousActivity(incident.id, userId, suspiciousResult.reason);
      }

      // Check for duplicate SOS submissions
      const deduplicationResult = await checkDuplicate({
        sosId: incident.id,
        userSessionId: sessionId,
        userId,
        emergencyType: data.emergencyType,
        latitude: data.latitude,
        longitude: data.longitude,
        createdAt: new Date(data.timestamp),
      });
      if (deduplicationResult.isDuplicate && deduplicationResult.duplicateOf) {
        await flagDuplicate(incident.id, deduplicationResult.duplicateOf);
      }
    } catch (postCreationErr) {
      // Log but do not fail the response — SOS was already created successfully
      console.error('Post-creation check error (non-blocking):', postCreationErr);
    }

    // Auto-dispatch: find nearest matching station and assign (non-blocking)
    try {
      if (data.latitude != null && data.longitude != null) {
        const stationMatch = await findNearestStation(
          data.emergencyType,
          data.latitude,
          data.longitude
        );

        if (stationMatch) {
          // Update the SOS record with the assigned station
          await dbQuery(
            `UPDATE sos_incidents SET assigned_station_id = $1 WHERE id = $2`,
            [stationMatch.id, incident.id]
          );

          // Broadcast station alert via WebSocket
          broadcastStationAlert(stationMatch.id, {
            sosId: incident.id,
            emergencyType: data.emergencyType,
            latitude: data.latitude,
            longitude: data.longitude,
            distanceMeters: stationMatch.distanceMeters,
            priorityBand: (incident.priority_band as 'critical' | 'high' | 'medium' | 'low') ?? 'low',
            createdAt: new Date(data.timestamp),
            description: data.description ?? null,
          });
        }
      }
    } catch (autoDispatchErr) {
      // Log but do not fail the response — SOS was already created successfully
      console.error('Auto-dispatch error (non-blocking):', autoDispatchErr);
    }

    res.status(201).json(incident);
  } catch (err) {
    // Handle duplicate key (UUID already exists)
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'SOS with this ID already exists' });
      return;
    }
    console.error('Create SOS error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/sos
 * List SOS incidents with optional status filter.
 * Query params: status (comma-separated statuses), limit (default 100)
 * No auth required for command center initial load.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    let sql = `SELECT
      id, user_session_id, user_id, emergency_type,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      accuracy, location_method, location_timestamp,
      people_count, situation_type, description,
      priority_score, priority_band, status,
      region_id, assigned_responder_id, disaster_event_id,
      duplicate_flag, duplicate_of, created_at, updated_at
    FROM sos_incidents`;

    const params: (string | number)[] = [];
    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim());
      const placeholders = statuses.map((_, i) => `$${i + 1}`).join(',');
      sql += ` WHERE status IN (${placeholders})`;
      params.push(...statuses);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await dbQuery(sql, params);
    res.status(200).json({ incidents: result.rows });
  } catch (err) {
    console.error('List SOS error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
/**
 * GET /api/sos/history
 * Get the authenticated survivor's SOS history.
 * Must be defined BEFORE /:id to avoid route conflict.
 */
router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const incidents = await getSOSHistory(userId);
    res.status(200).json({ incidents });
  } catch (err) {
    console.error('Get SOS history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/sos/station
 * Get SOS incidents assigned to the authenticated user's station.
 * The station is determined by matching the user's ID to stations.operator_user_id
 * or via the stationId query parameter (for dispatchers/admins).
 *
 * Query params:
 *   - stationId: (optional) explicit station ID to filter by
 *   - status: (optional) comma-separated status filter
 */
router.get('/station', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const explicitStationId = req.query.stationId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    let stationId: string | null = explicitStationId ?? null;

    // If no explicit stationId, look up by operator_user_id
    if (!stationId) {
      const stationResult = await dbQuery<{ id: string }>(
        `SELECT id FROM stations WHERE operator_user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      );
      if (stationResult.rows.length > 0) {
        stationId = stationResult.rows[0].id;
      }
    }

    if (!stationId) {
      res.status(200).json({ incidents: [], stationId: null });
      return;
    }

    let sql = `
      SELECT
        si.id, si.user_session_id, si.user_id, si.emergency_type,
        ST_Y(si.location::geometry) as latitude,
        ST_X(si.location::geometry) as longitude,
        si.accuracy, si.location_method, si.location_timestamp,
        si.people_count, si.situation_type, si.description,
        si.priority_score, si.priority_band, si.status,
        si.region_id, si.assigned_responder_id, si.assigned_station_id,
        si.disaster_event_id, si.duplicate_flag, si.duplicate_of,
        si.created_at, si.updated_at,
        s.name as station_name
      FROM sos_incidents si
      LEFT JOIN stations s ON s.id = si.assigned_station_id
      WHERE si.assigned_station_id = $1
    `;

    const params: (string | number)[] = [stationId];

    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim());
      const placeholders = statuses.map((_, i) => `$${i + 2}`).join(',');
      sql += ` AND si.status IN (${placeholders})`;
      params.push(...statuses);
    }

    sql += ` ORDER BY si.created_at DESC LIMIT 100`;

    const result = await dbQuery(sql, params);
    res.status(200).json({ incidents: result.rows, stationId });
  } catch (err) {
    console.error('Get station SOS error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/sos/:id
 * Retrieve SOS incident details by ID.
 */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const paramResult = uuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'Invalid SOS ID format' });
      return;
    }

    const incident = await getSOSById(paramResult.data.id);
    if (!incident) {
      res.status(404).json({ error: 'SOS incident not found' });
      return;
    }

    res.status(200).json(incident);
  } catch (err) {
    console.error('Get SOS error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/sos/:id
 * Update optional additional info (people count, situation type, description).
 */
router.patch('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const paramResult = uuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'Invalid SOS ID format' });
      return;
    }

    const bodyResult = updateSOSSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: bodyResult.error.issues,
      });
      return;
    }

    const incident = await updateSOS(
      paramResult.data.id,
      bodyResult.data,
      req.user!.id
    );

    if (!incident) {
      res.status(404).json({ error: 'SOS incident not found' });
      return;
    }

    res.status(200).json(incident);
  } catch (err) {
    console.error('Update SOS error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/sos/:id/timeline
 * Get the SOS event timeline ordered chronologically.
 */
router.get('/:id/timeline', authenticate, async (req: Request, res: Response) => {
  try {
    const paramResult = uuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'Invalid SOS ID format' });
      return;
    }

    // Verify the SOS exists
    const incident = await getSOSById(paramResult.data.id);
    if (!incident) {
      res.status(404).json({ error: 'SOS incident not found' });
      return;
    }

    const events = await getSOSTimeline(paramResult.data.id);
    res.status(200).json({ events });
  } catch (err) {
    console.error('Get SOS timeline error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/sos/:id/ack
 * Acknowledge an SOS incident (dispatcher action).
 * Requires 'sos:acknowledge' permission.
 * Returns 409 on invalid state transition.
 */
router.post(
  '/:id/ack',
  authenticate,
  authorize('sos:acknowledge'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      const result = await acknowledgeSOS(paramResult.data.id, req.user!.id);

      if (!result.success) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      res.status(200).json(result.incident);
    } catch (err) {
      console.error('Acknowledge SOS error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Dispatch Options Route ──────────────────────────────────────────────────
// Requirements: 4.3, 8.1

/**
 * GET /api/sos/:id/dispatch-options
 * Get ranked dispatch options (available responders) for an SOS incident.
 * Calls the geo-dispatch engine: detectRegion → getResponderPool → rankResponders.
 * Returns the top 10 ranked responders with distance, type, freshness, and score.
 * Requires 'sos:dispatch' permission.
 */
router.get(
  '/:id/dispatch-options',
  authenticate,
  authorize('sos:dispatch'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      // Fetch the incident
      const incident = await getSOSById(paramResult.data.id);
      if (!incident) {
        res.status(404).json({ error: 'SOS incident not found' });
        return;
      }

      // Detect region from incident location
      const regionResult = await detectRegion(incident.latitude, incident.longitude);

      // If no region can be resolved, still try to rank with null region
      const regionId = regionResult.regionId;

      // Get responder pool - if region is resolved, use it; otherwise get all available
      let candidates: Awaited<ReturnType<typeof getResponderPool>>;
      if (regionId) {
        candidates = await getResponderPool(regionId, incident.emergency_type);
      } else {
        // No region found - return empty array (no candidates available)
        candidates = [];
      }

      // Rank the candidates
      const ranked = rankResponders(
        candidates,
        incident.latitude ?? 0,
        incident.longitude ?? 0,
        incident.emergency_type,
        regionId,
        { maxResults: 10 }
      );

      // Enrich with station names by looking up station_id from candidates
      const responderStationMap = new Map<string, string | null>();
      for (const candidate of candidates) {
        responderStationMap.set(candidate.id, candidate.station_id);
      }

      // Look up station names for all relevant station IDs
      const stationIds = [...new Set(
        candidates
          .map(c => c.station_id)
          .filter((id): id is string => id !== null)
      )];

      const stationNameMap = new Map<string, string>();
      if (stationIds.length > 0) {
        const placeholders = stationIds.map((_, i) => `$${i + 1}`).join(', ');
        const stationResult = await dbQuery<{ id: string; name: string }>(
          `SELECT id, name FROM stations WHERE id IN (${placeholders})`,
          stationIds
        );
        for (const row of stationResult.rows) {
          stationNameMap.set(row.id, row.name);
        }
      }

      // Build response with type and station name from candidates
      const responderTypeMap = new Map<string, string>();
      for (const candidate of candidates) {
        responderTypeMap.set(candidate.id, candidate.type);
      }

      const responders = ranked.map(r => {
        const stationId = responderStationMap.get(r.responderId) ?? null;
        return {
          id: r.responderId,
          name: r.name,
          type: responderTypeMap.get(r.responderId) ?? 'unknown',
          distance: r.distanceKm,
          freshness: r.locationFreshness,
          score: r.suitabilityScore,
          stationName: stationId ? (stationNameMap.get(stationId) ?? null) : null,
          status: r.status,
        };
      });

      res.status(200).json({ responders });
    } catch (err) {
      console.error('Get dispatch options error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Dispatch Route ──────────────────────────────────────────────────────────
// Requirements: 4.4, 8.2

/**
 * POST /api/sos/:id/dispatch
 * Assign a responder to an SOS incident, transition to 'dispatched',
 * broadcast via WebSocket, and start escalation timer.
 * Requires 'sos:dispatch' permission.
 */
router.post(
  '/:id/dispatch',
  authenticate,
  authorize('sos:dispatch'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      const bodyResult = dispatchBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
        });
        return;
      }

      const sosId = paramResult.data.id;
      const { responderId } = bodyResult.data;

      // Fetch the incident
      const incident = await getSOSById(sosId);
      if (!incident) {
        res.status(404).json({ error: 'SOS incident not found' });
        return;
      }

      // Validate state transition: must be 'acknowledged' → 'dispatched'
      if (!isValidTransition(incident.status, 'dispatched')) {
        res.status(409).json({
          error: `Invalid state transition from '${incident.status}' to 'dispatched'`,
        });
        return;
      }

      // Update SOS status to 'dispatched' and assign responder
      const client = await getClient();
      try {
        await client.query('BEGIN');

        const updateResult = await client.query(
          `UPDATE sos_incidents
           SET status = 'dispatched',
               assigned_responder_id = $1,
               updated_at = NOW()
           WHERE id = $2
           RETURNING
             id, user_session_id, user_id, emergency_type,
             ST_Y(location::geometry) as latitude,
             ST_X(location::geometry) as longitude,
             accuracy, location_method, location_timestamp,
             people_count, situation_type, description,
             priority_score, priority_band, status,
             region_id, assigned_responder_id, disaster_event_id,
             duplicate_flag, duplicate_of, created_at, updated_at`,
          [responderId, sosId]
        );

        // Record state transition event
        await client.query(
          `INSERT INTO sos_events (sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp)
           VALUES ($1, 'state_transition', $2, $3, $4, $5, NOW())`,
          [
            sosId,
            req.user!.id,
            incident.status,
            'dispatched',
            JSON.stringify({ action: 'dispatch', responderId }),
          ]
        );

        await client.query('COMMIT');

        const updatedIncident = updateResult.rows[0];

        // Broadcast dispatch:assigned via WebSocket (include incident lat/lng for responder mini-map)
        broadcastDispatchAssignment(responderId, {
          incidentId: sosId,
          responderId,
          responderName: '', // Will be populated by the client from responder data
          emergencyType: incident.emergency_type,
          priorityBand: incident.priority_band as 'critical' | 'high' | 'medium' | 'low',
          timestamp: new Date(),
          latitude: updatedIncident.latitude != null ? Number(updatedIncident.latitude) : undefined,
          longitude: updatedIncident.longitude != null ? Number(updatedIncident.longitude) : undefined,
        });

        // Broadcast state change to survivor and command center
        broadcastStateChange(incident.user_session_id ?? sosId, {
          sosId,
          previousState: incident.status,
          newState: 'dispatched',
          actorId: req.user!.id,
          timestamp: new Date(),
        });

        // Start escalation timer with the assigned responder
        await startEscalation(
          sosId,
          [responderId],
          incident.priority_band as 'critical' | 'high' | 'medium' | 'low'
        );

        // Send push notification to survivor (non-blocking)
        notifySOSStateChange(sosId, 'dispatched', updatedIncident.user_id, updatedIncident.user_session_id).catch((pushErr) => {
          console.error('Push notification failed for dispatch:', pushErr);
        });

        res.status(200).json({ success: true, incident: updatedIncident });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Dispatch SOS error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Station Response Route ──────────────────────────────────────────────────

const stationRespondSchema = z.object({
  stationId: z.string().uuid(),
  status: z.enum(['responding', 'arrived', 'resolved']),
});

/**
 * POST /api/sos/:id/station-respond
 * Station operator responds to an assigned SOS.
 * Transitions: responding → enRoute, arrived → arrived, resolved → resolved.
 * Broadcasts sos:stateChange to survivor and command center.
 * Requires authentication (station operator logged in).
 */
router.post(
  '/:id/station-respond',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      const bodyResult = stationRespondSchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
        });
        return;
      }

      const sosId = paramResult.data.id;
      const { stationId, status: responseStatus } = bodyResult.data;

      // Map station response status to SOS state
      const stateMap: Record<string, SOSStatus> = {
        responding: 'enRoute',
        arrived: 'arrived',
        resolved: 'resolved',
      };
      const newState = stateMap[responseStatus];

      // Fetch the incident
      const incident = await getSOSById(sosId);
      if (!incident) {
        res.status(404).json({ error: 'SOS incident not found' });
        return;
      }

      // Verify this station is assigned to this SOS
      if (incident.assigned_station_id !== stationId) {
        res.status(403).json({ error: 'Station is not assigned to this SOS' });
        return;
      }

      // Validate state transition
      if (!isValidTransition(incident.status, newState)) {
        res.status(409).json({
          error: `Invalid state transition from '${incident.status}' to '${newState}'`,
        });
        return;
      }

      // Get station name for the broadcast
      const stationResult = await dbQuery<{ name: string }>(
        `SELECT name FROM stations WHERE id = $1`,
        [stationId]
      );
      const stationName = stationResult.rows[0]?.name ?? 'Station';

      // Update SOS status
      const client = await getClient();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE sos_incidents SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newState, sosId]
        );

        // Record state transition event with station metadata
        await client.query(
          `INSERT INTO sos_events (sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp)
           VALUES ($1, 'state_transition', $2, $3, $4, $5, NOW())`,
          [
            sosId,
            req.user!.id,
            incident.status,
            newState,
            JSON.stringify({ action: 'station_respond', stationId, stationName }),
          ]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Broadcast state change to survivor and command center
      broadcastStateChange(incident.user_session_id ?? sosId, {
        sosId,
        previousState: incident.status,
        newState: newState,
        actorId: req.user!.id,
        timestamp: new Date(),
        metadata: { stationName, stationId },
      });

      res.status(200).json({
        success: true,
        sosId,
        newState,
        stationName,
      });
    } catch (err) {
      console.error('Station respond error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Responder Workflow Lifecycle Routes ──────────────────────────────────────
// Requirements: 21.1, 21.2, 21.3, 22.1, 22.2, 22.3, 22.4

/**
 * POST /api/sos/:id/enroute
 * Mark an SOS incident as en route (responder is on the way).
 * Requires 'responder:manage' permission.
 * Returns 409 on invalid state transition.
 */
router.post(
  '/:id/enroute',
  authenticate,
  authorize('responder:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      const responderId = req.user!.id;
      const result = await markEnRoute(paramResult.data.id, responderId);

      if (!result.success) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      res.status(200).json(result);
    } catch (err) {
      console.error('Mark en route error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/sos/:id/arrived
 * Mark an SOS incident as arrived (responder is on scene).
 * Requires 'responder:manage' permission.
 * Returns 409 on invalid state transition.
 */
router.post(
  '/:id/arrived',
  authenticate,
  authorize('responder:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      const responderId = req.user!.id;
      const result = await markArrived(paramResult.data.id, responderId);

      if (!result.success) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      res.status(200).json(result);
    } catch (err) {
      console.error('Mark arrived error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/sos/:id/resolved
 * Mark an SOS incident as resolved (incident complete).
 * Requires 'responder:manage' permission.
 * Returns 409 on invalid state transition.
 */
router.post(
  '/:id/resolved',
  authenticate,
  authorize('responder:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid SOS ID format' });
        return;
      }

      const responderId = req.user!.id;
      const result = await markResolved(paramResult.data.id, responderId);

      if (!result.success) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      res.status(200).json(result);
    } catch (err) {
      console.error('Mark resolved error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export { router as sosRouter };
