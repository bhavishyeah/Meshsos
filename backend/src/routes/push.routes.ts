/**
 * Push Notification Routes for MeshSOS Backend.
 *
 * POST /api/push/subscribe - Register a push subscription
 *
 * Requirements: 11.1, 11.2
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { registerSubscription } from '../services/push.service.js';

const router = Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  expirationTime: z.number().nullable().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/push/subscribe
 * Register a push subscription for the authenticated user.
 */
router.post('/subscribe', authenticate, async (req: Request, res: Response) => {
  try {
    const parseResult = subscribeSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues,
      });
      return;
    }

    const { endpoint, keys } = parseResult.data;
    const userId = req.user!.id;

    const subscription = await registerSubscription(
      userId,
      null,
      { endpoint, keys }
    );

    res.status(201).json({ success: true, id: subscription.id });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as pushRouter };
