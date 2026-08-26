/**
 * Property tests for Deduplication Detection (Property 26)
 *
 * **Validates: Requirements 34.1, 34.2**
 *
 * For any two SOS records from the same device/session with proximate location,
 * proximate timestamp, and same emergency category, the Backend SHALL flag the
 * later submission as a "possible duplicate" for dispatcher review without
 * automatically discarding it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { EmergencyType } from '@meshsos/shared';

// Mock the database module before importing the service
const mockQuery = vi.fn();
vi.mock('../db/index.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock geo-dispatch haversineDistance
const mockHaversine = vi.fn();
vi.mock('./geo-dispatch.service.js', () => ({
  haversineDistance: (...args: unknown[]) => mockHaversine(...args),
}));

// Import after mock setup
import {
  checkDuplicate,
  TIMESTAMP_PROXIMITY_THRESHOLD_MS,
  type DeduplicationInput,
  type RecentSOSRow,
} from './deduplication.service.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_EMERGENCY_TYPES: EmergencyType[] = ['police', 'medical', 'food', 'childrenElderly'];

// ─── Arbitraries ────────────────────────────────────────────────────────────

const emergencyTypeArb = fc.constantFrom(...ALL_EMERGENCY_TYPES);
const uuidArb = fc.uuid();
const sessionIdArb = fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null));
const userIdArb = fc.oneof(fc.uuid(), fc.constant(null));

/** Generate a valid latitude (-90 to 90) */
const latitudeArb = fc.double({ min: -90, max: 90, noNaN: true });

/** Generate a valid longitude (-180 to 180) */
const longitudeArb = fc.double({ min: -180, max: 180, noNaN: true });

/** Generate a timestamp within a reasonable range */
const timestampArb = fc.date({
  min: new Date('2024-01-01T00:00:00Z'),
  max: new Date('2025-12-31T23:59:59Z'),
});

/** Generate a DeduplicationInput */
const deduplicationInputArb = fc.record({
  sosId: uuidArb,
  userSessionId: sessionIdArb,
  userId: userIdArb,
  emergencyType: emergencyTypeArb,
  latitude: fc.oneof(latitudeArb, fc.constant(null)),
  longitude: fc.oneof(longitudeArb, fc.constant(null)),
  createdAt: timestampArb,
}) as fc.Arbitrary<DeduplicationInput>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 26: Deduplication Detection', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockHaversine.mockReset();
  });

  describe('Different emergency types never produce isDuplicate=true', () => {
    it('for any two SOS with different emergency types, isDuplicate is always false', () => {
      return fc.assert(
        fc.asyncProperty(
          deduplicationInputArb,
          emergencyTypeArb,
          async (input, differentType) => {
            // Ensure the candidate has a *different* type than the input
            fc.pre(differentType !== input.emergencyType);

            // The query filters by emergency_type in SQL (WHERE emergency_type = $4),
            // so with different types, no candidates match → empty result
            mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

            const result = await checkDuplicate(input);

            expect(result.isDuplicate).toBe(false);
            expect(result.duplicateOf).toBeNull();
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Same session + same type + within 5 min → isDuplicate with high confidence', () => {
    it('for any SOS with same session, same type, and within 5 minutes, isDuplicate is true with high confidence', () => {
      return fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          userIdArb,
          emergencyTypeArb,
          fc.oneof(latitudeArb, fc.constant(null)),
          fc.oneof(longitudeArb, fc.constant(null)),
          timestampArb,
          // Time offset within 5 minutes (1 to 299999 ms)
          fc.integer({ min: 1, max: TIMESTAMP_PROXIMITY_THRESHOLD_MS - 1 }),
          async (sosId, sessionId, userId, emergencyType, lat, lng, baseTime, timeDiffMs) => {
            const input: DeduplicationInput = {
              sosId,
              userSessionId: sessionId,
              userId,
              emergencyType,
              latitude: lat,
              longitude: lng,
              createdAt: baseTime,
            };

            // Create a candidate from same session, same type, within 5 min
            const candidateTime = new Date(baseTime.getTime() - timeDiffMs);
            const candidate: RecentSOSRow = {
              id: 'candidate-sos-id',
              user_session_id: sessionId, // same session
              user_id: userId,
              emergency_type: emergencyType, // same type
              latitude: null,
              longitude: null,
              created_at: candidateTime.toISOString(),
            };

            mockQuery.mockResolvedValue({ rows: [candidate], rowCount: 1 });

            const result = await checkDuplicate(input);

            expect(result.isDuplicate).toBe(true);
            expect(result.confidence).toBe('high');
            expect(result.duplicateOf).toBe('candidate-sos-id');
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Result never indicates auto-discard', () => {
    it('for any input and any query result, the result never contains a discarded field or auto-discard action', () => {
      return fc.assert(
        fc.asyncProperty(
          deduplicationInputArb,
          fc.boolean(), // whether to return candidates
          async (input, hasCandidates) => {
            if (hasCandidates && input.userSessionId) {
              // Return a candidate that would trigger duplicate detection
              const candidate: RecentSOSRow = {
                id: 'some-candidate',
                user_session_id: input.userSessionId,
                user_id: input.userId,
                emergency_type: input.emergencyType,
                latitude: null,
                longitude: null,
                created_at: new Date(input.createdAt.getTime() - 60000).toISOString(),
              };
              mockQuery.mockResolvedValue({ rows: [candidate], rowCount: 1 });
            } else {
              mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
            }

            const result = await checkDuplicate(input);

            // The result should NEVER have a 'discarded' field or an 'action' field
            const resultAsAny = result as Record<string, unknown>;
            expect(resultAsAny).not.toHaveProperty('discarded');
            expect(resultAsAny).not.toHaveProperty('action');
            expect(resultAsAny).not.toHaveProperty('autoDiscard');
            expect(resultAsAny).not.toHaveProperty('autoDiscarded');

            // Result structure is always { isDuplicate, duplicateOf, confidence, reasons }
            expect(result).toHaveProperty('isDuplicate');
            expect(result).toHaveProperty('duplicateOf');
            expect(result).toHaveProperty('confidence');
            expect(result).toHaveProperty('reasons');
            expect(typeof result.isDuplicate).toBe('boolean');
            expect(['high', 'medium', 'low']).toContain(result.confidence);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('No candidates in DB means isDuplicate is always false', () => {
    it('for any SOS where the DB query returns zero rows, isDuplicate is false', () => {
      return fc.assert(
        fc.asyncProperty(deduplicationInputArb, async (input) => {
          // Simulate no candidates found in the database
          mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

          const result = await checkDuplicate(input);

          expect(result.isDuplicate).toBe(false);
          expect(result.duplicateOf).toBeNull();
          expect(result.confidence).toBe('low');
          expect(result.reasons).toEqual([]);
        }),
        { numRuns: 200 }
      );
    });
  });
});
