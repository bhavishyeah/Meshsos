/**
 * Disaster Event Routes for MeshSOS.
 *
 * POST   /api/disasters          - Create disaster event (disaster:manage)
 * GET    /api/disasters          - List active/recent disasters (station:read)
 * GET    /api/disasters/:id      - Get disaster by ID (station:read)
 * PATCH  /api/disasters/:id      - Update disaster (disaster:manage)
 * POST   /api/disasters/:id/resolve - Resolve disaster (disaster:manage)
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import {
  createDisaster,
  getDisasterById,
  listDisasters,
  updateDisaster,
  resolveDisaster,
  type DisasterStatus,
} from '../services/disaster.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const severityEnum = z.enum(['low', 'moderate', 'high', 'critical']);
const statusEnum = z.enum(['active', 'resolved', 'monitoring']);

const createDisasterSchema = z.object({
  name: z.string().min(1).max(255),
  regionId: z.string().uuid().nullable().optional(),
  severity: severityEnum,
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable().optional(),
});

const updateDisasterSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  regionId: z.string().uuid().nullable().optional(),
  severity: severityEnum.optional(),
  status: statusEnum.optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().nullable().optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/disasters
 * Create a new disaster event.
 * Requires: authenticate + authorize('disaster:manage')
 */
router.post(
  '/',
  authenticate,
  authorize('disaster:manage'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = createDisasterSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
        return;
      }

      const disaster = await createDisaster(parseResult.data, req.user!.id);
      res.status(201).json(disaster);
    } catch (err) {
      console.error('Create disaster error:', err);
      res.status(500).json({ error: 'Failed to create disaster event' });
    }
  }
);

/**
 * GET /api/disasters
 * List disaster events with optional filters.
 * Query params: status, regionId, page, pageSize
 * Requires: authenticate + authorize('station:read')
 */
router.get(
  '/',
  authenticate,
  authorize('station:read'),
  async (req: Request, res: Response) => {
    try {
      const { status, regionId, page, pageSize } = req.query;

      const filters: {
        status?: DisasterStatus;
        regionId?: string;
        page?: number;
        pageSize?: number;
      } = {};

      if (status && typeof status === 'string') {
        const parsed = statusEnum.safeParse(status);
        if (parsed.success) {
          filters.status = parsed.data;
        }
      }

      if (regionId && typeof regionId === 'string') {
        filters.regionId = regionId;
      }

      if (page && typeof page === 'string') {
        const parsed = parseInt(page, 10);
        if (!isNaN(parsed) && parsed > 0) {
          filters.page = parsed;
        }
      }

      if (pageSize && typeof pageSize === 'string') {
        const parsed = parseInt(pageSize, 10);
        if (!isNaN(parsed) && parsed > 0) {
          filters.pageSize = parsed;
        }
      }

      const result = await listDisasters(filters);
      res.status(200).json(result);
    } catch (err) {
      console.error('List disasters error:', err);
      res.status(500).json({ error: 'Failed to list disaster events' });
    }
  }
);

/**
 * GET /api/disasters/:id
 * Get a disaster event by ID.
 * Requires: authenticate + authorize('station:read')
 */
router.get(
  '/:id',
  authenticate,
  authorize('station:read'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid disaster ID format' });
        return;
      }

      const disaster = await getDisasterById(paramResult.data.id);
      if (!disaster) {
        res.status(404).json({ error: 'Disaster event not found' });
        return;
      }

      res.status(200).json(disaster);
    } catch (err) {
      console.error('Get disaster error:', err);
      res.status(500).json({ error: 'Failed to retrieve disaster event' });
    }
  }
);

/**
 * PATCH /api/disasters/:id
 * Update a disaster event.
 * Requires: authenticate + authorize('disaster:manage')
 */
router.patch(
  '/:id',
  authenticate,
  authorize('disaster:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid disaster ID format' });
        return;
      }

      const bodyResult = updateDisasterSchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
        });
        return;
      }

      const disaster = await updateDisaster(
        paramResult.data.id,
        bodyResult.data,
        req.user!.id
      );

      if (!disaster) {
        res.status(404).json({ error: 'Disaster event not found' });
        return;
      }

      res.status(200).json(disaster);
    } catch (err) {
      console.error('Update disaster error:', err);
      res.status(500).json({ error: 'Failed to update disaster event' });
    }
  }
);

/**
 * POST /api/disasters/:id/resolve
 * Resolve a disaster event — sets status to 'resolved' and end_at to now.
 * Requires: authenticate + authorize('disaster:manage')
 */
router.post(
  '/:id/resolve',
  authenticate,
  authorize('disaster:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid disaster ID format' });
        return;
      }

      const { disaster, alreadyResolved } = await resolveDisaster(
        paramResult.data.id,
        req.user!.id
      );

      if (!disaster) {
        res.status(404).json({ error: 'Disaster event not found' });
        return;
      }

      if (alreadyResolved) {
        res.status(200).json({ message: 'Disaster already resolved', disaster });
        return;
      }

      res.status(200).json(disaster);
    } catch (err) {
      console.error('Resolve disaster error:', err);
      res.status(500).json({ error: 'Failed to resolve disaster event' });
    }
  }
);

export { router as disasterRouter };
