/**
 * Disaster Service for MeshSOS.
 *
 * CRUD operations for disaster events with audit trail integration.
 * - create(): Create a new disaster event linked to a region
 * - getById(): Retrieve a disaster event by ID
 * - list(): List active/recent disaster events with optional filters
 * - update(): Update disaster event properties
 * - resolve(): Set status to 'resolved' and record end_at timestamp
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4
 */

import { query } from '../db/index.js';
import { record as auditRecord } from './audit.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DisasterSeverity = 'low' | 'moderate' | 'high' | 'critical';
export type DisasterStatus = 'active' | 'resolved' | 'monitoring';

export interface DisasterEvent {
  id: string;
  name: string;
  region_id: string | null;
  severity: DisasterSeverity;
  status: DisasterStatus;
  start_at: Date;
  end_at: Date | null;
  created_at: Date;
}

export interface CreateDisasterInput {
  name: string;
  regionId?: string | null;
  severity: DisasterSeverity;
  startAt: string; // ISO 8601
  endAt?: string | null; // ISO 8601
}

export interface UpdateDisasterInput {
  name?: string;
  regionId?: string | null;
  severity?: DisasterSeverity;
  status?: DisasterStatus;
  startAt?: string;
  endAt?: string | null;
}

export interface DisasterListFilters {
  status?: DisasterStatus;
  regionId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedDisasterResult {
  disasters: DisasterEvent[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Creates a new disaster event and records an audit event.
 */
export async function createDisaster(
  input: CreateDisasterInput,
  actorId: string
): Promise<DisasterEvent> {
  const sql = `
    INSERT INTO disaster_events (name, region_id, severity, status, start_at, end_at)
    VALUES ($1, $2, $3, 'active', $4, $5)
    RETURNING id, name, region_id, severity, status, start_at, end_at, created_at
  `;

  const params = [
    input.name,
    input.regionId ?? null,
    input.severity,
    input.startAt,
    input.endAt ?? null,
  ];

  const result = await query<DisasterEvent>(sql, params);
  const disaster = result.rows[0];

  // Record audit event
  await auditRecord({
    eventType: 'disaster:created',
    actorId,
    targetEntityId: disaster.id,
    newState: JSON.stringify({
      name: disaster.name,
      regionId: disaster.region_id,
      severity: disaster.severity,
      status: disaster.status,
      startAt: disaster.start_at,
    }),
    metadata: { regionId: disaster.region_id, severity: disaster.severity },
  });

  return disaster;
}

/**
 * Retrieves a disaster event by ID.
 */
export async function getDisasterById(id: string): Promise<DisasterEvent | null> {
  const sql = `
    SELECT id, name, region_id, severity, status, start_at, end_at, created_at
    FROM disaster_events
    WHERE id = $1
  `;

  const result = await query<DisasterEvent>(sql, [id]);
  return result.rows[0] ?? null;
}

/**
 * Lists disaster events with optional filters and pagination.
 * Defaults to showing active/monitoring events ordered by most recent first.
 */
export async function listDisasters(
  filters: DisasterListFilters = {}
): Promise<PaginatedDisasterResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.regionId) {
    conditions.push(`region_id = $${paramIndex++}`);
    params.push(filters.regionId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching records
  const countSql = `SELECT COUNT(*)::int AS total FROM disaster_events ${whereClause}`;
  const countResult = await query<{ total: number }>(countSql, params);
  const total = countResult.rows[0]?.total ?? 0;

  // Fetch paginated results
  const dataSql = `
    SELECT id, name, region_id, severity, status, start_at, end_at, created_at
    FROM disaster_events
    ${whereClause}
    ORDER BY start_at DESC, created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  const dataResult = await query<DisasterEvent>(dataSql, [...params, pageSize, offset]);

  return {
    disasters: dataResult.rows,
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  };
}

/**
 * Updates a disaster event and records an audit event.
 * Returns null if the disaster event is not found.
 */
export async function updateDisaster(
  id: string,
  input: UpdateDisasterInput,
  actorId: string
): Promise<DisasterEvent | null> {
  // Fetch current state for audit trail
  const existing = await getDisasterById(id);
  if (!existing) {
    return null;
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(input.name);
  }

  if (input.regionId !== undefined) {
    setClauses.push(`region_id = $${paramIndex++}`);
    params.push(input.regionId);
  }

  if (input.severity !== undefined) {
    setClauses.push(`severity = $${paramIndex++}`);
    params.push(input.severity);
  }

  if (input.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    params.push(input.status);
  }

  if (input.startAt !== undefined) {
    setClauses.push(`start_at = $${paramIndex++}`);
    params.push(input.startAt);
  }

  if (input.endAt !== undefined) {
    setClauses.push(`end_at = $${paramIndex++}`);
    params.push(input.endAt);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  params.push(id);
  const sql = `
    UPDATE disaster_events
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, region_id, severity, status, start_at, end_at, created_at
  `;

  const result = await query<DisasterEvent>(sql, params);
  const updated = result.rows[0];

  // Record audit event
  await auditRecord({
    eventType: 'disaster:updated',
    actorId,
    targetEntityId: id,
    previousState: JSON.stringify({
      name: existing.name,
      regionId: existing.region_id,
      severity: existing.severity,
      status: existing.status,
    }),
    newState: JSON.stringify({
      name: updated.name,
      regionId: updated.region_id,
      severity: updated.severity,
      status: updated.status,
    }),
    metadata: { updatedFields: Object.keys(input) },
  });

  return updated;
}

/**
 * Resolves a disaster event — sets status to 'resolved' and end_at to now.
 * Returns null if the disaster event is not found.
 * Returns the existing event unchanged if already resolved.
 */
export async function resolveDisaster(
  id: string,
  actorId: string
): Promise<{ disaster: DisasterEvent | null; alreadyResolved: boolean }> {
  const existing = await getDisasterById(id);
  if (!existing) {
    return { disaster: null, alreadyResolved: false };
  }

  if (existing.status === 'resolved') {
    return { disaster: existing, alreadyResolved: true };
  }

  const sql = `
    UPDATE disaster_events
    SET status = 'resolved', end_at = NOW()
    WHERE id = $1
    RETURNING id, name, region_id, severity, status, start_at, end_at, created_at
  `;

  const result = await query<DisasterEvent>(sql, [id]);
  const resolved = result.rows[0];

  // Record audit event
  await auditRecord({
    eventType: 'disaster:resolved',
    actorId,
    targetEntityId: id,
    previousState: existing.status,
    newState: 'resolved',
    metadata: {
      name: existing.name,
      regionId: existing.region_id,
      severity: existing.severity,
      resolvedAt: resolved.end_at,
    },
  });

  return { disaster: resolved, alreadyResolved: false };
}
