/**
 * Rate Limiting Middleware for MeshSOS.
 *
 * - SOS rate limiter: 10 SOS creations per minute per user/session
 * - General API rate limiter: 100 requests per minute per user
 *
 * Returns 429 with Retry-After header when limits are exceeded.
 * Requirement references: 38.3, 39.1
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Key generator that identifies clients by authenticated user ID or IP address.
 */
function getUserKey(req: Request): string {
  if (req.user?.id) {
    return req.user.id;
  }
  // Fall back to IP for unauthenticated requests (e.g. SOS creation)
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * SOS creation rate limiter.
 * Limits to 10 SOS creations per minute per user/session.
 * Applied specifically to POST /api/sos.
 */
export const sosRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: getUserKey,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    error: 'Too many SOS requests. Please try again shortly.',
    retryAfter: 60,
  },
  statusCode: 429,
});

/**
 * General API rate limiter.
 * Limits to 100 requests per minute per user.
 * Applied to all API endpoints.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    retryAfter: 60,
  },
  statusCode: 429,
});
