/**
 * Station Routes for MeshSOS Backend.
 *
 * POST   /api/stations      - Create station (authenticate + authorize('station:manage'))
 * GET    /api/stations      - List stations (authenticate + authorize('station:read'))
 * GET    /api/stations/:id  - Get station by ID (authenticate + authorize('station:read'))
 * PATCH  /api/stations/:id  - Update station (authenticate + authorize('station:manage'))
 * DELETE /api/stations/:id  - Deactivate station (authenticate + authorize('station:manage'))
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import {
  createStation,
  getStationById,
  listStations,
  updateStation,
  deactivateStation,
  StationValidationError,
} from '../services/station.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const stationTypeEnum = z.enum(['police', 'hospital', 'relief']);

const createStationSchema = z.object({
  name: z.string().min(1).max(255),
  type: stationTypeEnum,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  regionId: z.string().uuid().nullable().optional(),
  contact: z.string().max(100).nullable().optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  services: z.record(z.unknown()).nullable().optional(),
  officerCount: z.number().int().min(0).nullable().optional(),
});

const updateStationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: stationTypeEnum.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  regionId: z.string().uuid().nullable().optional(),
  contact: z.string().max(100).nullable().optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  services: z.record(z.unknown()).nullable().optional(),
  officerCount: z.number().int().min(0).nullable().optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  type: stationTypeEnum.optional(),
  status: z.string().optional(),
  regionId: z.string().uuid().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/stations
 * Create a new station (police, hospital, or relief center).
 * Requires station:manage permission (Supervisor+).
 */
router.post(
  '/',
  authenticate,
  authorize('station:manage'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = createStationSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
        return;
      }

      const station = await createStation(parseResult.data, req.user!.id);
      res.status(201).json(station);
    } catch (err) {
      if (err instanceof StationValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Create station error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/stations
 * List all stations with optional filters.
 * Requires station:read permission (Dispatcher+).
 */
router.get(
  '/',
  authenticate,
  authorize('station:read'),
  async (req: Request, res: Response) => {
    try {
      const queryResult = listQuerySchema.safeParse(req.query);
      const filters = queryResult.success ? queryResult.data : {};

      const stations = await listStations(filters);
      res.status(200).json({ stations });
    } catch (err) {
      console.error('List stations error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/stations/:id
 * Get a single station by ID.
 * Requires station:read permission (Dispatcher+).
 */
router.get(
  '/:id',
  authenticate,
  authorize('station:read'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid station ID format' });
        return;
      }

      const station = await getStationById(paramResult.data.id);
      if (!station) {
        res.status(404).json({ error: 'Station not found' });
        return;
      }

      res.status(200).json(station);
    } catch (err) {
      console.error('Get station error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/stations/:id
 * Update a station's details.
 * Requires station:manage permission (Supervisor+).
 */
router.patch(
  '/:id',
  authenticate,
  authorize('station:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid station ID format' });
        return;
      }

      const bodyResult = updateStationSchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: bodyResult.error.issues,
        });
        return;
      }

      const station = await updateStation(
        paramResult.data.id,
        bodyResult.data,
        req.user!.id
      );

      if (!station) {
        res.status(404).json({ error: 'Station not found' });
        return;
      }

      res.status(200).json(station);
    } catch (err) {
      if (err instanceof StationValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Update station error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/stations/:id
 * Deactivate a station (set status='inactive').
 * Requires station:manage permission (Supervisor+).
 */
router.delete(
  '/:id',
  authenticate,
  authorize('station:manage'),
  async (req: Request, res: Response) => {
    try {
      const paramResult = uuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Invalid station ID format' });
        return;
      }

      const station = await deactivateStation(paramResult.data.id, req.user!.id);

      if (!station) {
        res.status(404).json({ error: 'Station not found' });
        return;
      }

      res.status(200).json(station);
    } catch (err) {
      console.error('Deactivate station error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export { router as stationRouter };
