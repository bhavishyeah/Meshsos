/**
 * Unit tests for AuditService.
 *
 * Tests record() and queryAuditTrail() functions including:
 * - Successful audit event insertion
 * - Error propagation (AuditPersistenceError) on insert failure
 * - Paginated query with various filters
 * - Page size capping at 100
 * - Empty result handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import {
  record,
  queryAuditTrail,
  AuditPersistenceError,
  type AuditRecordInput,
  type AuditQueryFilters,
} from './audit.service.js';
import { query } from '../db/index.js';

const mockQuery = vi.mocked(query);

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('record()', () => {
    it('inserts an audit event with all fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] });

      const event: AuditRecordInput = {
        sosId: '123e4567-e89b-12d3-a456-426614174000',
        eventType: 'sos:stateTransition',
        actorId: '123e4567-e89b-12d3-a456-426614174001',
        targetEntityId: '123e4567-e89b-12d3-a456-426614174002',
        previousState: 'delivered',
        newState: 'acknowledged',
        metadata: { reason: 'dispatcher acknowledged' },
      };

      await record(event);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_trail');
      expect(params).toEqual([
        event.sosId,
        event.eventType,
        event.actorId,
        event.targetEntityId,
        JSON.stringify(event.previousState),
        JSON.stringify(event.newState),
        JSON.stringify(event.metadata),
      ]);
    });

    it('inserts an audit event with minimal fields (nulls for optional)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] });

      const event: AuditRecordInput = {
        eventType: 'auth:login',
        actorId: '123e4567-e89b-12d3-a456-426614174001',
      };

      await record(event);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [, params] = mockQuery.mock.calls[0];
      expect(params).toEqual([
        null,              // sosId
        'auth:login',     // eventType
        event.actorId,    // actorId
        null,             // targetEntityId
        null,             // previousState
        null,             // newState
        null,             // metadata
      ]);
    });

    it('throws AuditPersistenceError when insert fails', async () => {
      mockQuery.mockRejectedValue(new Error('Connection refused'));

      const event: AuditRecordInput = {
        eventType: 'sos:created',
        actorId: 'actor-1',
      };

      await expect(record(event)).rejects.toThrow(AuditPersistenceError);
      await expect(record(event)).rejects.toThrow(
        'Failed to persist audit event — originating operation must be rejected'
      );
    });

    it('AuditPersistenceError has correct name property', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const event: AuditRecordInput = {
        eventType: 'config:changed',
        actorId: 'actor-1',
      };

      try {
        await record(event);
      } catch (err) {
        expect(err).toBeInstanceOf(AuditPersistenceError);
        expect((err as AuditPersistenceError).name).toBe('AuditPersistenceError');
      }
    });
  });

  describe('queryAuditTrail()', () => {
    const mockAuditRow = {
      id: 'audit-1',
      sos_id: 'sos-1',
      event_type: 'sos:stateTransition',
      actor_id: 'actor-1',
      target_entity_id: 'target-1',
      previous_value: 'delivered',
      new_value: 'acknowledged',
      metadata: { reason: 'test' },
      timestamp: new Date('2024-01-15T10:30:00.000Z'),
    };

    it('returns paginated results with no filters', async () => {
      // Count query
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: 1 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Data query
      mockQuery.mockResolvedValueOnce({
        rows: [mockAuditRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await queryAuditTrail({});

      expect(result.events).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
      expect(result.hasMore).toBe(false);
      expect(result.events[0].id).toBe('audit-1');
      expect(result.events[0].eventType).toBe('sos:stateTransition');
      expect(result.events[0].actorId).toBe('actor-1');
    });

    it('applies sosId filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const filters: AuditQueryFilters = { sosId: 'sos-123' };
      await queryAuditTrail(filters);

      const [countSql, countParams] = mockQuery.mock.calls[0];
      expect(countSql).toContain('sos_id = $1');
      expect(countParams).toContain('sos-123');
    });

    it('applies actorId filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const filters: AuditQueryFilters = { actorId: 'actor-123' };
      await queryAuditTrail(filters);

      const [countSql, countParams] = mockQuery.mock.calls[0];
      expect(countSql).toContain('actor_id = $1');
      expect(countParams).toContain('actor-123');
    });

    it('applies eventType filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const filters: AuditQueryFilters = { eventType: 'auth:login' };
      await queryAuditTrail(filters);

      const [countSql, countParams] = mockQuery.mock.calls[0];
      expect(countSql).toContain('event_type = $1');
      expect(countParams).toContain('auth:login');
    });

    it('applies time range filters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const startDate = new Date('2024-01-01T00:00:00.000Z');
      const endDate = new Date('2024-01-31T23:59:59.999Z');
      const filters: AuditQueryFilters = { startDate, endDate };
      await queryAuditTrail(filters);

      const [countSql, countParams] = mockQuery.mock.calls[0];
      expect(countSql).toContain('timestamp >= $1');
      expect(countSql).toContain('timestamp <= $2');
      expect(countParams).toEqual([startDate.toISOString(), endDate.toISOString()]);
    });

    it('applies multiple filters simultaneously', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const filters: AuditQueryFilters = {
        sosId: 'sos-1',
        actorId: 'actor-1',
        eventType: 'sos:created',
      };
      await queryAuditTrail(filters);

      const [countSql, countParams] = mockQuery.mock.calls[0];
      expect(countSql).toContain('sos_id = $1');
      expect(countSql).toContain('actor_id = $2');
      expect(countSql).toContain('event_type = $3');
      expect(countParams).toEqual(['sos-1', 'actor-1', 'sos:created']);
    });

    it('caps page size at 100', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 200 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({ pageSize: 500 });

      expect(result.pageSize).toBe(100);
      // Verify LIMIT in data query is 100
      const [dataSql, dataParams] = mockQuery.mock.calls[1];
      expect(dataSql).toContain('LIMIT');
      expect(dataParams).toContain(100);
    });

    it('defaults to page 1 and pageSize 50', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('calculates hasMore correctly', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 120 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({ page: 1, pageSize: 50 });

      expect(result.hasMore).toBe(true);
    });

    it('calculates hasMore as false on last page', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 50 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({ page: 1, pageSize: 50 });

      expect(result.hasMore).toBe(false);
    });

    it('handles page > 1 with correct offset', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 150 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await queryAuditTrail({ page: 3, pageSize: 20 });

      const [, dataParams] = mockQuery.mock.calls[1];
      // offset should be (3-1)*20 = 40
      expect(dataParams).toContain(40);
    });

    it('maps database rows to AuditEvent objects correctly', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [mockAuditRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await queryAuditTrail({});
      const event = result.events[0];

      expect(event.id).toBe('audit-1');
      expect(event.sosId).toBe('sos-1');
      expect(event.eventType).toBe('sos:stateTransition');
      expect(event.actorId).toBe('actor-1');
      expect(event.timestamp).toEqual(new Date('2024-01-15T10:30:00.000Z'));
      expect(event.previousState).toBe('delivered');
      expect(event.newState).toBe('acknowledged');
      expect(event.metadata).toEqual({ reason: 'test' });
    });

    it('handles null sos_id in database row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...mockAuditRow, sos_id: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await queryAuditTrail({});
      expect(result.events[0].sosId).toBeUndefined();
    });

    it('handles null previous_value and new_value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...mockAuditRow, previous_value: null, new_value: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await queryAuditTrail({});
      expect(result.events[0].previousState).toBeUndefined();
      expect(result.events[0].newState).toBeUndefined();
    });

    it('returns empty events array when no results', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({});

      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('enforces minimum page of 1', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({ page: -5 });

      expect(result.page).toBe(1);
    });

    it('enforces minimum pageSize of 1', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await queryAuditTrail({ pageSize: 0 });

      expect(result.pageSize).toBe(1);
    });
  });
});
