/**
 * Property tests for Responder Workflow State Machine (Property 30)
 *
 * **Validates: Requirements 22.1, 22.2**
 *
 * Generates random SOS states and verifies only valid transitions are accepted:
 *   dispatched → enRoute → arrived → resolved
 *
 * Each workflow function (markEnRoute, markArrived, markResolved) must:
 * - Accept only when the current state is the expected predecessor
 * - Return 409 (conflict) when the current state is any other value
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { SOSStatus } from '@meshsos/shared';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock the database module
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockGetClient = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockClientRelease,
});

vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  getClient: () => mockGetClient(),
}));

// Mock audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

// Mock WebSocket broadcast
vi.mock('../websocket/index.js', () => ({
  broadcastStateChange: vi.fn(),
}));

import { markEnRoute, markArrived, markResolved } from './workflow.service.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_SOS_STATES: SOSStatus[] = [
  'created',
  'saved',
  'queued',
  'sending',
  'delivered',
  'acknowledged',
  'dispatched',
  'enRoute',
  'arrived',
  'resolved',
  'failed',
  'permanentlyFailed',
];

// ─── Arbitraries ────────────────────────────────────────────────────────────

const incidentIdArb = fc.uuid();
const responderIdArb = fc.uuid();
const sosStateArb = fc.constantFrom<SOSStatus>(...ALL_SOS_STATES);

/**
 * Generates a random SOS state that is NOT the given valid state.
 */
function invalidStateFor(validState: SOSStatus): fc.Arbitrary<SOSStatus> {
  return fc.constantFrom(...ALL_SOS_STATES.filter((s) => s !== validState));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sets up the mock database client to return a given current state
 * for an SOS incident assigned to the specified responder.
 */
function setupMockForState(currentState: SOSStatus, responderId: string) {
  mockClientQuery.mockImplementation((sql: string) => {
    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
      return Promise.resolve();
    }
    if (sql.includes('SELECT')) {
      return Promise.resolve({
        rows: [
          {
            status: currentState,
            assigned_responder_id: responderId,
            user_session_id: 'session-123',
          },
        ],
        rowCount: 1,
      });
    }
    // UPDATE or INSERT
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 30: Responder Workflow State Machine', () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockGetClient.mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
  });

  describe('markEnRoute accepts only when current state is dispatched', () => {
    it('succeeds for any incident when current state is dispatched', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          async (incidentId, responderId) => {
            setupMockForState('dispatched', responderId);

            const result = await markEnRoute(incidentId, responderId);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.previousState).toBe('dispatched');
              expect(result.newState).toBe('enRoute');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects with 409 for any state other than dispatched', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          invalidStateFor('dispatched'),
          async (incidentId, responderId, wrongState) => {
            setupMockForState(wrongState, responderId);

            const result = await markEnRoute(incidentId, responderId);

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(409);
              expect(result.error).toContain('Invalid state transition');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('markArrived accepts only when current state is enRoute', () => {
    it('succeeds for any incident when current state is enRoute', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          async (incidentId, responderId) => {
            setupMockForState('enRoute', responderId);

            const result = await markArrived(incidentId, responderId);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.previousState).toBe('enRoute');
              expect(result.newState).toBe('arrived');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects with 409 for any state other than enRoute', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          invalidStateFor('enRoute'),
          async (incidentId, responderId, wrongState) => {
            setupMockForState(wrongState, responderId);

            const result = await markArrived(incidentId, responderId);

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(409);
              expect(result.error).toContain('Invalid state transition');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('markResolved accepts only when current state is arrived', () => {
    it('succeeds for any incident when current state is arrived', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          async (incidentId, responderId) => {
            setupMockForState('arrived', responderId);

            const result = await markResolved(incidentId, responderId);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.previousState).toBe('arrived');
              expect(result.newState).toBe('resolved');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects with 409 for any state other than arrived', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          invalidStateFor('arrived'),
          async (incidentId, responderId, wrongState) => {
            setupMockForState(wrongState, responderId);

            const result = await markResolved(incidentId, responderId);

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(409);
              expect(result.error).toContain('Invalid state transition');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('All workflow functions reject invalid states with 409', () => {
    it('for any random state, exactly one of the three functions accepts it', () => {
      return fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          responderIdArb,
          sosStateArb,
          async (incidentId, responderId, randomState) => {
            setupMockForState(randomState, responderId);

            const [enRouteResult, arrivedResult, resolvedResult] = await Promise.all([
              markEnRoute(incidentId, responderId),
              markArrived(incidentId, responderId),
              markResolved(incidentId, responderId),
            ]);

            const successes = [enRouteResult, arrivedResult, resolvedResult].filter(
              (r) => r.success
            );
            const failures = [enRouteResult, arrivedResult, resolvedResult].filter(
              (r) => !r.success
            );

            if (randomState === 'dispatched') {
              expect(enRouteResult.success).toBe(true);
              expect(arrivedResult.success).toBe(false);
              expect(resolvedResult.success).toBe(false);
            } else if (randomState === 'enRoute') {
              expect(enRouteResult.success).toBe(false);
              expect(arrivedResult.success).toBe(true);
              expect(resolvedResult.success).toBe(false);
            } else if (randomState === 'arrived') {
              expect(enRouteResult.success).toBe(false);
              expect(arrivedResult.success).toBe(false);
              expect(resolvedResult.success).toBe(true);
            } else {
              // For all other states, all three should fail with 409
              expect(successes).toHaveLength(0);
              failures.forEach((f) => {
                if (!f.success) {
                  expect(f.statusCode).toBe(409);
                }
              });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
