/**
 * Property tests for Location Freshness Calculation (Property 22)
 *
 * **Validates: Requirements 32.1, 32.2**
 *
 * For any responder with a recorded location_updated_at timestamp, Location_Freshness
 * SHALL equal the elapsed time since that timestamp, and for any responder whose freshness
 * exceeds the configured staleness threshold, the system SHALL flag that location as
 * potentially unreliable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// Mock the database module before importing the service
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import {
  rankResponders,
  type Responder,
  type RankingConfig,
} from './geo-dispatch.service.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_STALENESS_THRESHOLD_SEC = 300; // 5 minutes = 300 seconds
const INCIDENT_LAT = 28.6139;
const INCIDENT_LNG = 77.209;
const REGION_ID = 'region-abc-123';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a minimal responder object with the given location_updated_at timestamp.
 */
function makeResponder(locationUpdatedAt: string | null): Responder {
  return {
    id: 'resp-001',
    user_id: 'user-001',
    name: 'Test Responder',
    organization: 'Test Org',
    station_id: 'station-001',
    region_id: REGION_ID,
    type: 'police',
    latitude: INCIDENT_LAT + 0.01, // slightly offset for distance
    longitude: INCIDENT_LNG + 0.01,
    location_updated_at: locationUpdatedAt,
    status: 'available',
    current_incident_id: null,
    vehicle: null,
    capabilities: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 22: Location Freshness Calculation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('For any responder with location_updated_at N seconds ago, locationFreshness equals N (±1 second tolerance)', () => {
    it('freshness correctly reflects elapsed time since last update', () => {
      fc.assert(
        fc.property(
          // Generate random elapsed seconds (1 second to 1 hour)
          fc.integer({ min: 1, max: 3600 }),
          (elapsedSeconds) => {
            // Fix "now" to a well-known timestamp
            const now = new Date('2024-06-15T12:00:00Z').getTime();
            vi.setSystemTime(now);

            // Compute the location_updated_at timestamp N seconds ago
            const updatedAtMs = now - elapsedSeconds * 1000;
            const updatedAtIso = new Date(updatedAtMs).toISOString();

            const responder = makeResponder(updatedAtIso);

            const results = rankResponders(
              [responder],
              INCIDENT_LAT,
              INCIDENT_LNG,
              'police',
              REGION_ID
            );

            expect(results).toHaveLength(1);

            // locationFreshness should be within ±1 second of elapsedSeconds
            const freshness = results[0].locationFreshness;
            expect(freshness).toBeGreaterThanOrEqual(elapsedSeconds - 1);
            expect(freshness).toBeLessThanOrEqual(elapsedSeconds + 1);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('For any responder with freshness <= 300 seconds, isFresh is true', () => {
    it('responders updated within staleness threshold are flagged as fresh', () => {
      fc.assert(
        fc.property(
          // Generate random elapsed seconds within the threshold (0 to 300)
          fc.integer({ min: 0, max: DEFAULT_STALENESS_THRESHOLD_SEC }),
          (elapsedSeconds) => {
            const now = new Date('2024-06-15T12:00:00Z').getTime();
            vi.setSystemTime(now);

            const updatedAtMs = now - elapsedSeconds * 1000;
            const updatedAtIso = new Date(updatedAtMs).toISOString();

            const responder = makeResponder(updatedAtIso);

            const results = rankResponders(
              [responder],
              INCIDENT_LAT,
              INCIDENT_LNG,
              'police',
              REGION_ID
            );

            expect(results).toHaveLength(1);
            expect(results[0].isFresh).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('For any responder with freshness > 300 seconds, isFresh is false', () => {
    it('responders updated beyond staleness threshold are flagged as stale', () => {
      fc.assert(
        fc.property(
          // Generate random elapsed seconds beyond the threshold (301 to 7200)
          fc.integer({ min: DEFAULT_STALENESS_THRESHOLD_SEC + 1, max: 7200 }),
          (elapsedSeconds) => {
            const now = new Date('2024-06-15T12:00:00Z').getTime();
            vi.setSystemTime(now);

            const updatedAtMs = now - elapsedSeconds * 1000;
            const updatedAtIso = new Date(updatedAtMs).toISOString();

            const responder = makeResponder(updatedAtIso);

            const results = rankResponders(
              [responder],
              INCIDENT_LAT,
              INCIDENT_LNG,
              'police',
              REGION_ID
            );

            expect(results).toHaveLength(1);
            expect(results[0].isFresh).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('For any responder with null location_updated_at, isFresh is false', () => {
    it('responders with no location timestamp are always flagged as stale', () => {
      fc.assert(
        fc.property(
          // Generate random "now" timestamps to ensure independence from specific time
          fc.integer({ min: 1700000000000, max: 1800000000000 }),
          (nowMs) => {
            vi.setSystemTime(nowMs);

            const responder = makeResponder(null);

            const results = rankResponders(
              [responder],
              INCIDENT_LAT,
              INCIDENT_LNG,
              'police',
              REGION_ID
            );

            expect(results).toHaveLength(1);
            expect(results[0].isFresh).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
