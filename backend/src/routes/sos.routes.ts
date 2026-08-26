/**
 * SOS Routes for MeshSOS Backend.
 *
 * POST   /api/sos              - Create new SOS (optionalAuthenticate)
 * GET    /api/sos/history      - Get survivor's SOS history (authenticate)
 * GET    /api/sos/:id          - Get SOS details (authenticate)
 * PATCH  /api/sos/:id          - Update SOS additional info (authenticate)
 * GET    /api/sos/:id/timeline - Get SOS event timeline (authenticate)
 * POST   /api/sos/:id/ack      - Acknowledge SOS (authenticate + authorize)
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
});

const updateSOSSchema = z.object({
  peopleCount: z.number().int().min(1).nullable().optional(),
  situationType: z.string().max(50).nullable().optional(),
  description: z.string().max(200).nullable().optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
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
      userSessionId: null,
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

    const { query: dbQuery } = await import('../db/index.js');
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
