/**
 * Metrics API Route - GET /api/metrics
 *
 * Returns operational metrics for the admin dashboard:
 * - Total incidents in the last 24 hours
 * - Average response time (seconds) for resolved incidents in 24h
 * - Active responder count
 * - Incident breakdown by emergency type
 * - Incident breakdown by priority band
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import { query } from '../db/index.js';

export const metricsRouter = Router();

metricsRouter.get(
  '/',
  authenticate,
  authorize('metrics:read'),
  async (_req, res) => {
    try {
      // Total incidents created in the last 24 hours
      const totalResult = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM sos_incidents WHERE created_at > NOW() - INTERVAL '24 hours'`
      );

      // Average response time (seconds) for incidents resolved in the last 24 hours
      const avgResponseResult = await query<{ avg_seconds: string | null }>(
        `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) AS avg_seconds
         FROM sos_incidents
         WHERE status = 'resolved'
           AND updated_at > NOW() - INTERVAL '24 hours'`
      );

      // Active responders (not offline)
      const activeRespondersResult = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM responders WHERE status != 'offline'`
      );

      // Incidents by emergency type in the last 24 hours
      const byTypeResult = await query<{ type: string; count: string }>(
        `SELECT emergency_type AS type, COUNT(*) AS count
         FROM sos_incidents
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY emergency_type
         ORDER BY count DESC`
      );

      // Incidents by priority band in the last 24 hours
      const byPriorityResult = await query<{ band: string; count: string }>(
        `SELECT priority_band AS band, COUNT(*) AS count
         FROM sos_incidents
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY priority_band
         ORDER BY count DESC`
      );

      const totalIncidents24h = parseInt(totalResult.rows[0]?.count ?? '0', 10);
      const avgResponseTimeSeconds = avgResponseResult.rows[0]?.avg_seconds
        ? parseFloat(avgResponseResult.rows[0].avg_seconds)
        : null;
      const activeResponders = parseInt(activeRespondersResult.rows[0]?.count ?? '0', 10);
      const byType = byTypeResult.rows.map((r) => ({ type: r.type, count: parseInt(r.count, 10) }));
      const byPriority = byPriorityResult.rows.map((r) => ({ band: r.band, count: parseInt(r.count, 10) }));

      res.json({
        totalIncidents24h,
        avgResponseTimeSeconds,
        activeResponders,
        byType,
        byPriority,
      });
    } catch (error) {
      console.error('Metrics query failed:', error);
      res.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  }
);
