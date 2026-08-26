/**
 * Region Routes for MeshSOS Backend.
 *
 * POST   /api/regions      - Create region (authenticate + authorize('config:manage'))
 * GET    /api/regions      - List regions (authenticate)
 * PATCH  /api/regions/:id  - Update region (authenticate + authorize('config:manage'))
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import {
  createRegion,
  listRegions,
  updateRegion,
  RegionValidationError,
} from '../services/region.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const geoJSONPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(z.array(z.array(z.number()).length(2)).min(4))
    .min(1),
});

const createRegionSchema = z.object({
  name: z.string().min(1),
  boundary: geoJSONPolygonSchema,
  status: z.enum(['active', 'inactive']).optional(),
});

const updateRegionSchema = z.object({
  name: z.string().min(1).optional(),
  boundary: geoJSONPolygonSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/regions
 * Create a new region with a GeoJSON Polygon boundary.
 * Requires administrator role (config:manage permission).
 */
router.post(
  '/',
  authenticate,
  authorize('config:manage'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = createRegionSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
        return;
      }

      const region = await createRegion(parseResult.data);
      res.status(201).json(region);
    } catch (err) {
      if (err instanceof RegionValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Create region error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/regions
 * List all regions with boundaries as GeoJSON.
 * Any authenticated user can view regions.
 */
router.get(
  '/',
  authenticate,
  async (_req: Request, res: Response) => {
    try {
      const regions = await listRegions();
      res.status(200).json({ regions });
    } catch (err) {
      console.error('List regions error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/regions/:id
 * Update a region's name, boundary, or status.
 * Requires administrator role (config:manage permission).
 */
router.patch(
  '/:id',
  authenticate,
  authorize('config:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid region ID format' });
        return;
      }

      const bodyResult = updateRegionSchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
        });
        return;
      }

      const region = await updateRegion(paramResult.data.id, bodyResult.data);

      if (!region) {
        res.status(404).json({ error: 'Region not found' });
        return;
      }

      res.status(200).json(region);
    } catch (err) {
      if (err instanceof RegionValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Update region error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export { router as regionRouter };
