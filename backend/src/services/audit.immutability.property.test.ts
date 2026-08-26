import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Property 12: Audit Immutability
 *
 * For any audit record once persisted, the system SHALL NOT allow modification or
 * deletion through any API endpoint or user-facing operation. If audit persistence
 * fails, the originating operation SHALL be rejected.
 *
 * **Validates: Requirements 40.4, 40.5**
 */

// Mock the database module before importing the service
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import {
  record,
  AuditPersistenceError,
  type AuditRecordInput,
} from './audit.service.js';
import { query } from '../db/index.js';

const mockQuery = vi.mocked(query);

/** All valid audit event types for generating random inputs */
const AUDIT_EVENT_TYPES = [
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
] as const;

// --- Arbitraries ---

const uuidArb = fc.uuid();

const auditEventTypeArb = fc.constantFrom(...AUDIT_EVENT_TYPES);

const metadataArb = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean())
  ),
  { nil: undefined }
);

const auditRecordInputArb: fc.Arbitrary<AuditRecordInput> = fc.record({
  sosId: fc.option(uuidArb, { nil: undefined }),
  eventType: auditEventTypeArb,
  actorId: uuidArb,
  targetEntityId: fc.option(uuidArb, { nil: undefined }),
  previousState: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  newState: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  metadata: metadataArb,
});

describe('Property 12: Audit Immutability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Failed audit persistence rejects the originating operation', () => {
    it('for any random audit event, if the database insert fails, record() throws AuditPersistenceError', async () => {
      await fc.assert(
        fc.asyncProperty(
          auditRecordInputArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (input, errorMsg) => {
            mockQuery.mockReset();
            mockQuery.mockRejectedValueOnce(new Error(errorMsg));

            await expect(record(input)).rejects.toThrow(AuditPersistenceError);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('the AuditPersistenceError message indicates the originating operation must be rejected', async () => {
      await fc.assert(
        fc.asyncProperty(auditRecordInputArb, async (input) => {
          mockQuery.mockReset();
          mockQuery.mockRejectedValueOnce(new Error('simulated DB failure'));

          try {
            await record(input);
            expect.fail('record() should have thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(AuditPersistenceError);
            const message = (err as AuditPersistenceError).message;
            expect(message.toLowerCase()).toContain('reject');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('record() only performs INSERT operations (never UPDATE or DELETE)', () => {
    it('for any random audit event, the SQL passed to the database contains INSERT and never UPDATE or DELETE', async () => {
      await fc.assert(
        fc.asyncProperty(auditRecordInputArb, async (input) => {
          mockQuery.mockReset();
          mockQuery.mockResolvedValueOnce({
            rows: [],
            rowCount: 1,
            command: 'INSERT',
            oid: 0,
            fields: [],
          });

          await record(input);

          expect(mockQuery).toHaveBeenCalledTimes(1);
          const [sql] = mockQuery.mock.calls[0];
          const sqlStr = String(sql).toUpperCase();

          // Must contain INSERT
          expect(sqlStr).toContain('INSERT');
          // Must NOT contain UPDATE or DELETE
          expect(sqlStr).not.toMatch(/\bUPDATE\b/);
          expect(sqlStr).not.toMatch(/\bDELETE\b/);
        }),
        { numRuns: 100 }
      );
    });
  });
});
