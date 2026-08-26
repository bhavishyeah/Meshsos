/**
 * Audit Service for MeshSOS.
 *
 * Provides append-only audit trail recording and paginated querying.
 * - record(): Inserts audit events into audit_trail table. Throws on failure
 *   so that callers can reject the originating operation.
 * - query(): Paginated retrieval with filters (sosId, actorId, eventType, time range).
 *   Max 100 results per page.
 */

import { query } from '../db/index.js';
import type { AuditEvent, AuditEventType } from '@meshsos/shared';

/**
 * Input for recording an audit event. The id and timestamp are generated server-side.
 */
export interface AuditRecordInput {
  sosId?: string;
  eventType: AuditEventType;
  actorId: string;
  targetEntityId?: string;
  previousState?: string;
  newState?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Filters for querying the audit trail.
 */
export interface AuditQueryFilters {
  sosId?: string;
  actorId?: string;
  eventType?: AuditEventType;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * Paginated result from audit trail queries.
 */
export interface PaginatedAuditResult {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Records an audit event in the append-only audit trail.
 *
 * If the insert fails, the error is thrown so that the caller can
 * reject the originating operation (per requirement 40.5).
 */
export async function record(event: AuditRecordInput): Promise<void> {
  const sql = `
    INSERT INTO audit_trail (sos_id, event_type, actor_id, target_entity_id, previous_value, new_value, metadata, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `;

  const params = [
    event.sosId ?? null,
    event.eventType,
    event.actorId,
    event.targetEntityId ?? null,
    event.previousState ? JSON.stringify(event.previousState) : null,
    event.newState ? JSON.stringify(event.newState) : null,
    event.metadata ? JSON.stringify(event.metadata) : null,
  ];

  try {
    await query(sql, params);
  } catch (err) {
    // Re-throw so the originating operation is rejected
    throw new AuditPersistenceError(
      'Failed to persist audit event — originating operation must be rejected',
      { cause: err }
    );
  }
}

/**
 * Queries the audit trail with pagination and optional filters.
 * Returns at most MAX_PAGE_SIZE (100) events per page.
 */
export async function queryAuditTrail(
  filters: AuditQueryFilters
): Promise<PaginatedAuditResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.sosId) {
    conditions.push(`sos_id = $${paramIndex++}`);
    params.push(filters.sosId);
  }

  if (filters.actorId) {
    conditions.push(`actor_id = $${paramIndex++}`);
    params.push(filters.actorId);
  }

  if (filters.eventType) {
    conditions.push(`event_type = $${paramIndex++}`);
    params.push(filters.eventType);
  }

  if (filters.startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(filters.startDate.toISOString());
  }

  if (filters.endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(filters.endDate.toISOString());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching records
  const countSql = `SELECT COUNT(*)::int AS total FROM audit_trail ${whereClause}`;
  const countResult = await query<{ total: number }>(countSql, params);
  const total = countResult.rows[0]?.total ?? 0;

  // Fetch paginated results ordered by timestamp descending (most recent first)
  const dataSql = `
    SELECT id, sos_id, event_type, actor_id, target_entity_id, previous_value, new_value, metadata, timestamp
    FROM audit_trail
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  const dataResult = await query<{
    id: string;
    sos_id: string | null;
    event_type: string;
    actor_id: string | null;
    target_entity_id: string | null;
    previous_value: unknown;
    new_value: unknown;
    metadata: Record<string, unknown> | null;
    timestamp: Date;
  }>(dataSql, [...params, pageSize, offset]);

  const events: AuditEvent[] = dataResult.rows.map((row) => ({
    id: row.id,
    sosId: row.sos_id ?? undefined,
    eventType: row.event_type as AuditEventType,
    actorId: row.actor_id ?? '',
    timestamp: new Date(row.timestamp),
    previousState: row.previous_value != null ? String(row.previous_value) : undefined,
    newState: row.new_value != null ? String(row.new_value) : undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));

  return {
    events,
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  };
}

/**
 * Custom error class for audit persistence failures.
 * Callers should catch this to reject the originating operation.
 */
export class AuditPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuditPersistenceError';
  }
}
