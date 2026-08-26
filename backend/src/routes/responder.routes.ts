/**
 * Responder Routes for MeshSOS Backend.
 *
 * PATCH  /api/responders/:id/status  - Update responder status (authenticate + authorize('responder:manage'))
 * GET    /api/responders/:id         - Get responder by ID (authenticate + authorize('responder:read'))
 * GET    /api/responders             - List responders by region (authenticate + authorize('responder:read'))
 *
 * Requirements: 19.1, 19.3
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import {
  updateResponderStatus,
  getResponderById,
  getRespondersByRegion,
  listAllResponders,
  createResponder,
  ResponderValidationError,
  VALID_RESPONDER_STATUSES,
} from '../services/responder.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const responderStatusEnum = z.enum([
  'available',
  'busy',
  'assigned',
  'enRoute',
  'onScene',
  'offline',
]);

const updateStatusSchema = z.object({
  status: responderStatusEnum,
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  regionId: z.string().uuid().optional(),
});

const createResponderSchema = z.object({
  userId: z.string().uuid(),
  stationId: z.string().uuid(),
  type: z.enum(['police', 'medical', 'rescue', 'relief', 'social']),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * PATCH /api/responders/:id/status
 * Update a responder's availability status.
 * Requires responder:manage permission.
 *
 * Requirement 19.1: Set status to Available, Busy, Assigned, En Route, On Scene, or Offline
 * Requirement 19.3: Record status change with timestamp for audit
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize('responder:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid responder ID format' });
        return;
      }

      const bodyResult = updateStatusSchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
          validStatuses: VALID_RESPONDER_STATUSES,
        });
        return;
      }

      const responder = await updateResponderStatus(
        paramResult.data.id,
        bodyResult.data.status,
        req.user!.id
      );

      if (!responder) {
        res.status(404).json({ error: 'Responder not found' });
        return;
      }

      res.status(200).json(responder);
    } catch (err) {
      if (err instanceof ResponderValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Update responder status error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/responders/:id
 * Get a single responder by ID.
 * Requires responder:read permission.
 */
router.get(
  '/:id',
  authenticate,
  authorize('responder:read'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid responder ID format' });
        return;
      }

      const responder = await getResponderById(paramResult.data.id);
      if (!responder) {
        res.status(404).json({ error: 'Responder not found' });
        return;
      }

      res.status(200).json(responder);
    } catch (err) {
      console.error('Get responder error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/responders
 * Create a new responder.
 * Requires responder:manage permission.
 */
router.post(
  '/',
  authenticate,
  authorize('responder:manage'),
  async (req: Request, res: Response) => {
    try {
      const bodyResult = createResponderSchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
        });
        return;
      }

      const responder = await createResponder(bodyResult.data);
      res.status(201).json(responder);
    } catch (err) {
      if (err instanceof ResponderValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Create responder error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/responders
 * List responders. If regionId is provided, filter by region.
 * Otherwise return all responders (admin view).
 * Requires responder:read permission.
 */
router.get(
  '/',
  authenticate,
  authorize('responder:read'),
  async (req: Request, res: Response) => {
    try {
      const queryResult = listQuerySchema.safeParse(req.query);
      const filters = queryResult.success ? queryResult.data : {};

      if (filters.regionId) {
        const responders = await getRespondersByRegion(filters.regionId);
        res.status(200).json({ responders });
      } else {
        const responders = await listAllResponders();
        res.status(200).json({ responders });
      }
    } catch (err) {
      console.error('List responders error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export { router as responderRouter };
