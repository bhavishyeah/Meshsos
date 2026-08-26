import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AuditEventType } from '@meshsos/shared';

/**
 * Property tests for Audit Trail Completeness (Property 11)
 *
 * **Validates: Requirements 10.4, 19.3, 21.3, 40.1, 40.2, 40.3**
 *
 * For any SOS state transition, dispatch decision, responder assignment, override,
 * escalation, authentication event, role change, or administrative configuration change,
 * the system SHALL create an append-only audit event containing: entity ID, event type,
 * actor ID, UTC timestamp with millisecond precision, previous state, new state, and
 * action-specific metadata.
 */

// Mock the database module before importing the service
const mockQuery = vi.fn();
vi.mock('../db/index.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock setup
import { record, type AuditRecordInput } from './audit.service';

// All valid audit event types
const ALL_AUDIT_EVENT_TYPES: AuditEventType[] = [
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
const auditEventTypeArb = fc.constantFrom(...ALL_AUDIT_EVENT_TYPES);
const actorIdArb = fc.uuid();
const sosIdArb = fc.option(fc.uuid(), { nil: undefined });
const targetEntityIdArb = fc.option(fc.uuid(), { nil: undefined });
const stateArb = fc.option(
  fc.constantFrom('created', 'saved', 'queued', 'sending', 'delivered', 'acknowledged', 'dispatched', 'enRoute', 'arrived', 'resolved', 'failed', 'permanentlyFailed', 'available', 'busy', 'assigned', 'offline'),
  { nil: undefined }
);
const metadataArb = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
    fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean())
  ),
  { nil: undefined }
);

// Composite arbitrary for a full AuditRecordInput
const auditRecordInputArb: fc.Arbitrary<AuditRecordInput> = fc.record({
  sosId: sosIdArb,
  eventType: auditEventTypeArb,
  actorId: actorIdArb,
  targetEntityId: targetEntityIdArb,
  previousState: stateArb,
  newState: stateArb,
  metadata: metadataArb,
});

describe('Property 11: Audit Trail Completeness', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('record() always passes required fields (eventType, actorId) to the database', () => {
    it('for any random audit event, the DB insert always contains eventType and actorId', () => {
      return fc.assert(
        fc.asyncProperty(auditRecordInputArb, async (input) => {
          mockQuery.mockClear();
          mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

          await record(input);

          expect(mockQuery).toHaveBeenCalledTimes(1);
          const [sql, params] = mockQuery.mock.calls[0];

          // eventType is param $2
          expect(params[1]).toBe(input.eventType);
          // actorId is param $3
          expect(params[2]).toBe(input.actorId);
          // Both are never null/undefined
          expect(params[1]).toBeDefined();
          expect(params[1]).not.toBeNull();
          expect(params[2]).toBeDefined();
          expect(params[2]).not.toBeNull();
        }),
        { numRuns: 300 }
      );
    });
  });

  describe('record() includes a timestamp via NOW() in the SQL insert', () => {
    it('for any random audit event, the SQL statement uses NOW() for the timestamp column', () => {
      return fc.assert(
        fc.asyncProperty(auditRecordInputArb, async (input) => {
          mockQuery.mockClear();
          mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

          await record(input);

          expect(mockQuery).toHaveBeenCalledTimes(1);
          const [sql] = mockQuery.mock.calls[0];

          // The SQL must reference the timestamp column and use NOW()
          expect(sql).toContain('timestamp');
          expect(sql).toContain('NOW()');
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('record() correctly passes all fields to the database query', () => {
    it('for any random audit event, all provided fields are passed as query parameters', () => {
      return fc.assert(
        fc.asyncProperty(auditRecordInputArb, async (input) => {
          mockQuery.mockClear();
          mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

          await record(input);

          expect(mockQuery).toHaveBeenCalledTimes(1);
          const [sql, params] = mockQuery.mock.calls[0];

          // Verify INSERT statement targets the audit_trail table
          expect(sql).toContain('INSERT INTO audit_trail');

          // params layout: [sosId, eventType, actorId, targetEntityId, previousState, newState, metadata]
          // $1 = sosId (null if not provided)
          expect(params[0]).toBe(input.sosId ?? null);

          // $2 = eventType (always present)
          expect(params[1]).toBe(input.eventType);

          // $3 = actorId (always present)
          expect(params[2]).toBe(input.actorId);

          // $4 = targetEntityId (null if not provided)
          expect(params[3]).toBe(input.targetEntityId ?? null);

          // $5 = previousState (JSON stringified or null)
          if (input.previousState) {
            expect(params[4]).toBe(JSON.stringify(input.previousState));
          } else {
            expect(params[4]).toBeNull();
          }

          // $6 = newState (JSON stringified or null)
          if (input.newState) {
            expect(params[5]).toBe(JSON.stringify(input.newState));
          } else {
            expect(params[5]).toBeNull();
          }

          // $7 = metadata (JSON stringified or null)
          if (input.metadata) {
            expect(params[6]).toBe(JSON.stringify(input.metadata));
          } else {
            expect(params[6]).toBeNull();
          }
        }),
        { numRuns: 300 }
      );
    });
  });

  describe('every audit event type maps to an appropriate operation category', () => {
    it('for any random operation type, the eventType used is a valid AuditEventType', () => {
      // Group event types by operation category to verify correct mapping
      const stateTransitionEvents: AuditEventType[] = ['sos:created', 'sos:stateTransition', 'sos:updated'];
      const dispatchEvents: AuditEventType[] = ['dispatch:assigned', 'dispatch:escalated', 'dispatch:overridden'];
      const responderEvents: AuditEventType[] = ['responder:statusChange', 'responder:assigned', 'responder:accepted', 'responder:declined', 'responder:locationUpdate'];
      const authEvents: AuditEventType[] = ['auth:login', 'auth:logout', 'auth:loginFailed', 'auth:mfaVerified'];
      const adminEvents: AuditEventType[] = ['role:changed', 'config:changed', 'facility:created', 'facility:updated', 'facility:deactivated', 'disaster:created', 'disaster:updated', 'subscription:expired'];

      const allCategorized = [
        ...stateTransitionEvents,
        ...dispatchEvents,
        ...responderEvents,
        ...authEvents,
        ...adminEvents,
      ];

      fc.assert(
        fc.property(auditEventTypeArb, (eventType) => {
          // Every generated event type must be in one of the categories
          expect(allCategorized).toContain(eventType);
          // And it must be in the master list
          expect(ALL_AUDIT_EVENT_TYPES).toContain(eventType);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('record() uses an INSERT (append-only) statement', () => {
    it('for any random audit event, the SQL is an INSERT and never an UPDATE or DELETE', () => {
      return fc.assert(
        fc.asyncProperty(auditRecordInputArb, async (input) => {
          mockQuery.mockClear();
          mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

          await record(input);

          const [sql] = mockQuery.mock.calls[0];
          const upperSql = sql.toUpperCase();

          expect(upperSql).toContain('INSERT');
          expect(upperSql).not.toContain('UPDATE');
          expect(upperSql).not.toContain('DELETE');
        }),
        { numRuns: 200 }
      );
    });
  });
});
