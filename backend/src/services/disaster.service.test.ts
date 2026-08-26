/**
 * Unit tests for DisasterService.
 *
 * Tests CRUD operations and resolve logic with mocked database.
 * Covers: create, getById, list, update, resolve, audit trail integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn(),
}));

import {
  createDisaster,
  getDisasterById,
  listDisasters,
  updateDisaster,
  resolveDisaster,
  type CreateDisasterInput,
  type UpdateDisasterInput,
} from './disaster.service.js';
import { query } from '../db/index.js';
import { record as auditRecord } from './audit.service.js';

const mockQuery = vi.mocked(query);
const mockAuditRecord = vi.mocked(auditRecord);

// ─── Test Data ──────────────────────────────────────────────────────────────

const ACTOR_ID = '00000000-0000-0000-0000-000000000001';
const DISASTER_ID = '00000000-0000-0000-0000-000000000010';
const REGION_ID = '00000000-0000-0000-0000-000000000020';

const sampleDisaster = {
  id: DISASTER_ID,
  name: 'Flood Event 2024',
  region_id: REGION_ID,
  severity: 'high' as const,
  status: 'active' as const,
  start_at: new Date('2024-01-15T08:00:00Z'),
  end_at: null,
  created_at: new Date('2024-01-15T08:00:00Z'),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DisasterService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditRecord.mockResolvedValue(undefined);
  });

  describe('createDisaster()', () => {
    it('inserts a disaster event and returns it', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleDisaster],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const input: CreateDisasterInput = {
        name: 'Flood Event 2024',
        regionId: REGION_ID,
        severity: 'high',
        startAt: '2024-01-15T08:00:00Z',
      };

      const result = await createDisaster(input, ACTOR_ID);

      expect(result).toEqual(sampleDisaster);
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO disaster_events'),
        ['Flood Event 2024', REGION_ID, 'high', '2024-01-15T08:00:00Z', null]
      );
    });

    it('records an audit event on creation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleDisaster],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const input: CreateDisasterInput = {
        name: 'Flood Event 2024',
        regionId: REGION_ID,
        severity: 'high',
        startAt: '2024-01-15T08:00:00Z',
      };

      await createDisaster(input, ACTOR_ID);

      expect(mockAuditRecord).toHaveBeenCalledOnce();
      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'disaster:created',
          actorId: ACTOR_ID,
          targetEntityId: DISASTER_ID,
        })
      );
    });

    it('creates a disaster without a region', async () => {
      const disasterNoRegion = { ...sampleDisaster, region_id: null };
      mockQuery.mockResolvedValueOnce({
        rows: [disasterNoRegion],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const input: CreateDisasterInput = {
        name: 'Earthquake',
        severity: 'critical',
        startAt: '2024-01-15T08:00:00Z',
      };

      const result = await createDisaster(input, ACTOR_ID);

      expect(result.region_id).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO disaster_events'),
        ['Earthquake', null, 'critical', '2024-01-15T08:00:00Z', null]
      );
    });

    it('passes endAt when provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...sampleDisaster, end_at: new Date('2024-01-20T08:00:00Z') }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const input: CreateDisasterInput = {
        name: 'Flood Event 2024',
        regionId: REGION_ID,
        severity: 'high',
        startAt: '2024-01-15T08:00:00Z',
        endAt: '2024-01-20T08:00:00Z',
      };

      await createDisaster(input, ACTOR_ID);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO disaster_events'),
        ['Flood Event 2024', REGION_ID, 'high', '2024-01-15T08:00:00Z', '2024-01-20T08:00:00Z']
      );
    });
  });

  describe('getDisasterById()', () => {
    it('returns a disaster event when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleDisaster],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getDisasterById(DISASTER_ID);

      expect(result).toEqual(sampleDisaster);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        [DISASTER_ID]
      );
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getDisasterById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('listDisasters()', () => {
    it('returns paginated disaster events with no filters', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total: 2 }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [sampleDisaster, { ...sampleDisaster, id: 'another-id' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await listDisasters();

      expect(result.disasters).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.hasMore).toBe(false);
    });

    it('filters by status', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total: 1 }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [sampleDisaster],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await listDisasters({ status: 'active' });

      expect(result.disasters).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['active']
      );
    });

    it('filters by region', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total: 1 }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [sampleDisaster],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await listDisasters({ regionId: REGION_ID });

      expect(result.disasters).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('region_id = $1'),
        [REGION_ID]
      );
    });

    it('caps page size at MAX_PAGE_SIZE (50)', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total: 0 }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await listDisasters({ pageSize: 100 });

      expect(result.pageSize).toBe(50);
    });

    it('returns hasMore=true when more records exist', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total: 25 }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: Array(10).fill(sampleDisaster),
          rowCount: 10,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await listDisasters({ pageSize: 10 });

      expect(result.hasMore).toBe(true);
    });
  });

  describe('updateDisaster()', () => {
    it('updates fields and returns the updated disaster', async () => {
      const updatedDisaster = { ...sampleDisaster, name: 'Updated Name', severity: 'critical' as const };

      // First call: getDisasterById (existing check)
      mockQuery.mockResolvedValueOnce({
        rows: [sampleDisaster],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Second call: UPDATE
      mockQuery.mockResolvedValueOnce({
        rows: [updatedDisaster],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const input: UpdateDisasterInput = { name: 'Updated Name', severity: 'critical' };
      const result = await updateDisaster(DISASTER_ID, input, ACTOR_ID);

      expect(result).toEqual(updatedDisaster);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('returns null if disaster not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const input: UpdateDisasterInput = { name: 'New Name' };
      const result = await updateDisaster(DISASTER_ID, input, ACTOR_ID);

      expect(result).toBeNull();
      expect(mockAuditRecord).not.toHaveBeenCalled();
    });

    it('records an audit event on update', async () => {
      const updatedDisaster = { ...sampleDisaster, severity: 'critical' as const };

      mockQuery
        .mockResolvedValueOnce({
          rows: [sampleDisaster],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [updatedDisaster],
          rowCount: 1,
          command: 'UPDATE',
          oid: 0,
          fields: [],
        });

      await updateDisaster(DISASTER_ID, { severity: 'critical' }, ACTOR_ID);

      expect(mockAuditRecord).toHaveBeenCalledOnce();
      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'disaster:updated',
          actorId: ACTOR_ID,
          targetEntityId: DISASTER_ID,
        })
      );
    });

    it('returns existing disaster if no fields to update', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [sampleDisaster],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await updateDisaster(DISASTER_ID, {}, ACTOR_ID);

      expect(result).toEqual(sampleDisaster);
      // Only the getById query should be called, not update
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(mockAuditRecord).not.toHaveBeenCalled();
    });
  });

  describe('resolveDisaster()', () => {
    it('resolves an active disaster event', async () => {
      const resolvedDisaster = {
        ...sampleDisaster,
        status: 'resolved' as const,
        end_at: new Date('2024-01-20T12:00:00Z'),
      };

      // getDisasterById call
      mockQuery.mockResolvedValueOnce({
        rows: [sampleDisaster],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // UPDATE call
      mockQuery.mockResolvedValueOnce({
        rows: [resolvedDisaster],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const result = await resolveDisaster(DISASTER_ID, ACTOR_ID);

      expect(result.disaster).toEqual(resolvedDisaster);
      expect(result.alreadyResolved).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'resolved', end_at = NOW()"),
        [DISASTER_ID]
      );
    });

    it('returns alreadyResolved=true if already resolved', async () => {
      const alreadyResolvedDisaster = {
        ...sampleDisaster,
        status: 'resolved' as const,
        end_at: new Date('2024-01-18T10:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({
        rows: [alreadyResolvedDisaster],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await resolveDisaster(DISASTER_ID, ACTOR_ID);

      expect(result.disaster).toEqual(alreadyResolvedDisaster);
      expect(result.alreadyResolved).toBe(true);
      // Should not attempt to update or record audit
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(mockAuditRecord).not.toHaveBeenCalled();
    });

    it('returns null if disaster not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await resolveDisaster(DISASTER_ID, ACTOR_ID);

      expect(result.disaster).toBeNull();
      expect(result.alreadyResolved).toBe(false);
      expect(mockAuditRecord).not.toHaveBeenCalled();
    });

    it('records an audit event on resolve', async () => {
      const resolvedDisaster = {
        ...sampleDisaster,
        status: 'resolved' as const,
        end_at: new Date('2024-01-20T12:00:00Z'),
      };

      mockQuery
        .mockResolvedValueOnce({
          rows: [sampleDisaster],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [resolvedDisaster],
          rowCount: 1,
          command: 'UPDATE',
          oid: 0,
          fields: [],
        });

      await resolveDisaster(DISASTER_ID, ACTOR_ID);

      expect(mockAuditRecord).toHaveBeenCalledOnce();
      expect(mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'disaster:resolved',
          actorId: ACTOR_ID,
          targetEntityId: DISASTER_ID,
          previousState: 'active',
          newState: 'resolved',
        })
      );
    });
  });
});
