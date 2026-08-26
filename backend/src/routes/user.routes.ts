/**
 * User Management Routes for MeshSOS Backend.
 *
 * POST /api/users - Create user (authenticate + authorize('user:manage'))
 * GET  /api/users - List users (authenticate + authorize('user:manage'))
 *
 * Requirements: 5.1, 5.2, 5.3, 8.4, 8.5
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import { createUser, listUsers, UserServiceError } from '../services/user.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['administrator', 'dispatcher', 'supervisor', 'responder', 'auditor']),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/users
 * Create a new user account.
 * Requires user:manage permission (Administrator only).
 */
router.post(
  '/',
  authenticate,
  authorize('user:manage'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = createUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
        return;
      }

      const { name, email, password, role } = parseResult.data;
      const user = await createUser(name, email, password, role);
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof UserServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Create user error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/users
 * List all user accounts.
 * Requires user:manage permission (Administrator only).
 */
router.get(
  '/',
  authenticate,
  authorize('user:manage'),
  async (_req: Request, res: Response) => {
    try {
      const users = await listUsers();
      res.status(200).json({ users });
    } catch (err) {
      console.error('List users error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export { router as userRouter };
