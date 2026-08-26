/**
 * Suspicious Activity Detection Service for MeshSOS Backend.
 *
 * Tracks SOS frequency per user/session and flags accounts exceeding
 * configurable thresholds for dispatcher review. Never blocks SOS submissions.
 *
 * Requirements: 39.1, 39.2, 39.3, 39.4
 */

import { query } from '../db/index.js';
import { record } from './audit.service.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface SuspiciousActivityConfig {
  /** Maximum SOS submissions allowed within the time window before flagging */
  maxSOSPerWindow: number;
  /** Time window in milliseconds for counting SOS frequency */
  windowMs: number;
}

export const DEFAULT_CONFIG: SuspiciousActivityConfig = {
  maxSOSPerWindow: 5,
  windowMs: 10 * 60 * 1000, // 10 minutes
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SuspiciousCheckResult {
  /** Whether the activity is flagged as suspicious */
  isSuspicious: boolean;
  /** Human-readable reason for the flag, null if not suspicious */
  reason: string | null;
  /** Number of SOS submissions found in the current time window */
  sosCountInWindow: number;
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Check whether a user or session has exceeded the SOS submission threshold
 * within the configured time window.
 *
 * Queries sos_incidents for the number of SOS records created by the user
 * or session in the last `windowMs` milliseconds. If the count meets or
 * exceeds `maxSOSPerWindow`, it returns isSuspicious=true.
 *
 * This function NEVER blocks SOS creation — it only returns a flag for
 * dispatcher review.
 *
 * @param userId - The user ID to check (can be null for anonymous users)
 * @param sessionId - The session ID to check (can be null)
 * @param config - Optional configuration override for thresholds
 * @returns SuspiciousCheckResult indicating whether the activity is suspicious
 */
export async function checkSuspiciousActivity(
  userId: string | null,
  sessionId: string | null,
  config: SuspiciousActivityConfig = DEFAULT_CONFIG
): Promise<SuspiciousCheckResult> {
  // If neither user nor session is available, we cannot track frequency
  if (!userId && !sessionId) {
    return { isSuspicious: false, reason: null, sosCountInWindow: 0 };
  }

  const windowStart = new Date(Date.now() - config.windowMs);

  // Build query to count SOS in the window for this user or session
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    params.push(userId);
  }

  if (sessionId) {
    conditions.push(`user_session_id = $${paramIndex++}`);
    params.push(sessionId);
  }

  // Use OR logic: match on either user_id or session_id
  const whereClause = conditions.length > 1
    ? `(${conditions.join(' OR ')})`
    : conditions[0];

  params.push(windowStart.toISOString());

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM sos_incidents
     WHERE ${whereClause}
       AND created_at >= $${paramIndex}`,
    params
  );

  const sosCountInWindow = countResult.rows[0]?.count ?? 0;

  if (sosCountInWindow >= config.maxSOSPerWindow) {
    return {
      isSuspicious: true,
      reason: `Exceeded SOS threshold: ${sosCountInWindow} submissions in ${config.windowMs / 60000} minute window (limit: ${config.maxSOSPerWindow})`,
      sosCountInWindow,
    };
  }

  return {
    isSuspicious: false,
    reason: null,
    sosCountInWindow,
  };
}

/**
 * Flag an SOS as suspicious in the audit trail.
 *
 * Records a 'sos:suspicious' event in the audit trail for dispatcher review.
 * Does NOT block or delete the SOS — it remains fully active.
 *
 * @param sosId - The ID of the SOS to flag
 * @param userId - The user who created the SOS (actor)
 * @param reason - Human-readable reason for flagging
 */
export async function flagSuspiciousActivity(
  sosId: string,
  userId: string | null,
  reason: string
): Promise<void> {
  await record({
    sosId,
    eventType: 'sos:suspicious',
    actorId: userId ?? 'system',
    metadata: {
      reason,
      flaggedAt: new Date().toISOString(),
    },
  });
}
