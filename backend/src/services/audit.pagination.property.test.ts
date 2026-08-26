import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AuditEventType } from '@meshsos/shared';

/**
 * Property 32: Audit Query Pagination
 *
 * For any audit trail query, the Backend SHALL return results filtered by the
 * specified criteria, ordered by timestamp, in pages of at most 100 records
 * per response.
 *
 * **Validates: Requirements 40.6**
 */

// Mock the db module before importing the service
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
}));

import { queryAuditTrail, type AuditQueryFilters } from './audit.service.js';
import { query as mockQuery } from '../db/index.js';

const AUDIT_EVENT_TYPES: AuditEventType[] = [
  'sos:created',
  'sos:stateTransition',
  'sos:updated',
  'dispatch:assigned',
  'dispatch:escalated',
  'dispatch:overridden',
  'responder:statusChange',
  'responder:assigned',
  'responder:accepted',
  'responder:declined',
  'responder:locationUpdate',
  'auth:login',
  'auth:logout',
  'auth:loginFailed',
  'auth:mfaVerified',
  'role:changed',
  'config:changed',
  'facility:created',
  'facility:updated',
  'facility:deactivated',
  'disaster:created',
  'disaster:updated',
  'subscription:expired',
];

// Arbitraries
const uuidArb = fc.uuid();
const eventTypeArb = fc.constantFrom(...AUDIT_EVENT_TYPES);
const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') });

function setupMockQuery(total: number) {
  vi.mocked(mockQuery).mockImplementation(async (sql: string) => {
    if (sql.includes('COUNT')) {
      return { rows: [{ total }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as any;
    }
    // Return empty events for the data query
    return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
  });
}

describe('Property 32: Audit Query Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pageSize is capped at MAX_PAGE_SIZE (100)', () => {
    it('for any pageSize > 100, the result pageSize is capped at 100', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 101, max: 10000 }),
          async (requestedPageSize) => {
            vi.clearAllMocks();
            setupMockQuery(0);

            const result = await queryAuditTrail({ pageSize: requestedPageSize });

            expect(result.pageSize).toBe(100);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('pageSize between 1-100 is respected', () => {
    it('for any pageSize between 1 and 100, the result pageSize matches the input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }),
          async (requestedPageSize) => {
            vi.clearAllMocks();
            setupMockQuery(0);

            const result = await queryAuditTrail({ pageSize: requestedPageSize });

            expect(result.pageSize).toBe(requestedPageSize);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('offset calculation is correct', () => {
    it('for any valid page and pageSize, the offset passed to the query is (page-1) * pageSize', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 1, max: 100 }),
          async (page, pageSize) => {
            vi.clearAllMocks();
            setupMockQuery(1000);

            await queryAuditTrail({ page, pageSize });

            // The data query is the second call (first is the count query)
            const calls = vi.mocked(mockQuery).mock.calls;
            expect(calls.length).toBe(2);

            const dataParams = calls[1][1] as unknown[];
            // offset is the last parameter, pageSize is second-to-last
            const actualOffset = dataParams[dataParams.length - 1];
            const actualPageSize = dataParams[dataParams.length - 2];
            const expectedOffset = (page - 1) * pageSize;

            expect(actualPageSize).toBe(pageSize);
            expect(actualOffset).toBe(expectedOffset);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('hasMore is true iff offset + pageSize < total', () => {
    it('for any page, pageSize, and total, hasMore correctly indicates remaining records', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 5000 }),
          async (page, pageSize, total) => {
            vi.clearAllMocks();
            setupMockQuery(total);

            const result = await queryAuditTrail({ page, pageSize });

            const offset = (page - 1) * pageSize;
            const expectedHasMore = offset + pageSize < total;

            expect(result.hasMore).toBe(expectedHasMore);
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('page is always >= 1', () => {
    it('for any negative or zero page number, the effective page is 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 0 }),
          async (requestedPage) => {
            vi.clearAllMocks();
            setupMockQuery(0);

            const result = await queryAuditTrail({ page: requestedPage });

            expect(result.page).toBe(1);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('for any positive page number, the result page matches the input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1000 }),
          async (requestedPage) => {
            vi.clearAllMocks();
            setupMockQuery(0);

            const result = await queryAuditTrail({ page: requestedPage });

            expect(result.page).toBe(requestedPage);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('filters are correctly applied to the query', () => {
    it('for any combination of filters, the SQL WHERE clause includes the correct conditions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            sosId: fc.option(uuidArb, { nil: undefined }),
            actorId: fc.option(uuidArb, { nil: undefined }),
            eventType: fc.option(eventTypeArb, { nil: undefined }),
            startDate: fc.option(dateArb, { nil: undefined }),
            endDate: fc.option(dateArb, { nil: undefined }),
          }),
          async (filterInputs) => {
            vi.clearAllMocks();
            setupMockQuery(0);

            const filters: AuditQueryFilters = { ...filterInputs };
            await queryAuditTrail(filters);

            const calls = vi.mocked(mockQuery).mock.calls;
            const countCall = calls[0];
            const countSql = countCall[0] as string;
            const countParams = countCall[1] as unknown[];

            // Verify each filter appears in the query when set
            if (filters.sosId) {
              expect(countSql).toContain('sos_id');
              expect(countParams).toContain(filters.sosId);
            }
            if (filters.actorId) {
              expect(countSql).toContain('actor_id');
              expect(countParams).toContain(filters.actorId);
            }
            if (filters.eventType) {
              expect(countSql).toContain('event_type');
              expect(countParams).toContain(filters.eventType);
            }
            if (filters.startDate) {
              expect(countSql).toContain('timestamp >=');
              expect(countParams).toContain(filters.startDate.toISOString());
            }
            if (filters.endDate) {
              expect(countSql).toContain('timestamp <=');
              expect(countParams).toContain(filters.endDate.toISOString());
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('results are ordered by timestamp', () => {
    it('for any query, the data SQL includes ORDER BY timestamp DESC', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          async (page) => {
            vi.clearAllMocks();
            setupMockQuery(100);

            await queryAuditTrail({ page });

            // The data query is the second call
            const calls = vi.mocked(mockQuery).mock.calls;
            expect(calls.length).toBe(2);

            const dataSql = calls[1][0] as string;
            expect(dataSql).toContain('ORDER BY timestamp DESC');
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
