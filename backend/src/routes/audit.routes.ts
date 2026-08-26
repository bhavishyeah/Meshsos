/**
 * Audit Routes for MeshSOS.
 *
 * GET /api/audit — Query audit trail with filters and pagination.
 * Requires authentication + audit:read permission.
 */

import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/rbac.middleware.js';
import { queryAuditTrail, type AuditQueryFilters } from '../services/audit.service.js';
import type { AuditEventType } from '@meshsos/shared';

const router = Router();

/**
 * GET /api/audit
 * Query params:
 *   - sosId: UUID filter for specific SOS
 *   - actorId: UUID filter for specific actor
 *   - eventType: filter for specific event type
 *   - startDate: ISO 8601 date string for range start
 *   - endDate: ISO 8601 date string for range end
 *   - page: page number (default 1)
 *   - pageSize: results per page (default 50, max 100)
 *
 * Requires: authenticate + authorize('audit:read')
 */
router.get('/', authenticate, authorize('audit:read'), async (req: Request, res: Response) => {
  try {
    const { sosId, actorId, eventType, startDate, endDate, page, pageSize } = req.query;

    const filters: AuditQueryFilters = {};

    if (sosId && typeof sosId === 'string') {
      filters.sosId = sosId;
    }

    if (actorId && typeof actorId === 'string') {
      filters.actorId = actorId;
    }

    if (eventType && typeof eventType === 'string') {
      filters.eventType = eventType as AuditEventType;
    }

    if (startDate && typeof startDate === 'string') {
      const parsed = new Date(startDate);
      if (!isNaN(parsed.getTime())) {
        filters.startDate = parsed;
      }
    }

    if (endDate && typeof endDate === 'string') {
      const parsed = new Date(endDate);
      if (!isNaN(parsed.getTime())) {
        filters.endDate = parsed;
      }
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

    const result = await queryAuditTrail(filters);
    res.status(200).json(result);
  } catch (err) {
    console.error('Audit query error:', err);
    res.status(500).json({ error: 'Failed to query audit trail' });
  }
});

export { router as auditRouter };
