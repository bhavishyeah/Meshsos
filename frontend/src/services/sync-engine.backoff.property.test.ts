/**
 * Property tests for Exponential Backoff (Property 5)
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * For any retry count, the SyncEngine SHALL calculate backoff delay as
 * min(30000ms × 2^retryCount, 300000ms), ensuring monotonically increasing
 * delays bounded within [baseRetryMs, maxRetryMs].
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ConnectivityState } from '@meshsos/shared';
import type { ConnectivityManager } from './connectivity.service';
import { SyncEngineImpl } from './sync-engine.service';

// Mock sosRepository to avoid IndexedDB dependency
vi.mock('../db/sos-repository', () => ({
  sosRepository: {
    getByStatus: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const BASE_RETRY_MS = 30000;
const MAX_RETRY_MS = 300000;

/** Create a minimal ConnectivityManager stub for constructing SyncEngineImpl */
function createStubConnectivityManager(): ConnectivityManager {
  const state: ConnectivityState = { status: 'connected', lastChecked: new Date() };
  return {
    getState: () => state,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  };
}

/** Create a SyncEngineImpl with default backoff config */
function createEngine(): SyncEngineImpl {
  return new SyncEngineImpl(createStubConnectivityManager(), {
    baseRetryMs: BASE_RETRY_MS,
    maxRetryMs: MAX_RETRY_MS,
    maxRetries: 10,
  });
}

// ─── Generators ─────────────────────────────────────────────────────────────

/**
 * Generate retry counts in a realistic range.
 * We go up to 20 to exercise values well beyond the cap threshold (retryCount >= 4 caps).
 */
const retryCountArb = fc.integer({ min: 0, max: 20 });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 5: Exponential Backoff', () => {
  const engine = createEngine();

  describe('Backoff formula correctness', () => {
    it('for any retryCount, backoff equals min(30000 * 2^retryCount, 300000)', () => {
      fc.assert(
        fc.property(retryCountArb, (retryCount) => {
          const actual = engine.calculateBackoff(retryCount);
          const expected = Math.min(BASE_RETRY_MS * Math.pow(2, retryCount), MAX_RETRY_MS);

          expect(actual).toBe(expected);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Backoff lower bound', () => {
    it('backoff is always >= baseRetryMs (30000) for any retryCount', () => {
      fc.assert(
        fc.property(retryCountArb, (retryCount) => {
          const backoff = engine.calculateBackoff(retryCount);

          expect(backoff).toBeGreaterThanOrEqual(BASE_RETRY_MS);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Backoff upper bound', () => {
    it('backoff is always <= maxRetryMs (300000) for any retryCount', () => {
      fc.assert(
        fc.property(retryCountArb, (retryCount) => {
          const backoff = engine.calculateBackoff(retryCount);

          expect(backoff).toBeLessThanOrEqual(MAX_RETRY_MS);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Monotonically increasing', () => {
    it('for any two retryCount values a < b, backoff(a) <= backoff(b)', () => {
      fc.assert(
        fc.property(
          retryCountArb,
          retryCountArb,
          (a, b) => {
            // Ensure a < b by sorting
            const [lower, higher] = a <= b ? [a, b] : [b, a];

            const backoffLower = engine.calculateBackoff(lower);
            const backoffHigher = engine.calculateBackoff(higher);

            expect(backoffLower).toBeLessThanOrEqual(backoffHigher);
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
