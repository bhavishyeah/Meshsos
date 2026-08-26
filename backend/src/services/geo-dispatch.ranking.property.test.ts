/**
 * Property tests for Responder Ranking Constraints (Property 21)
 *
 * **Validates: Requirements 31.1, 31.2, 31.3, 31.6**
 *
 * For any set of candidate responders, the ranking SHALL:
 * (a) exclude all responders with status Busy or Offline
 * (b) sort results in non-increasing order of suitabilityScore
 * (c) return at most 10 results (default maxResults)
 * (d) break ties by most recent location update
 * (e) flag stale responders (location freshness > threshold) with isFresh=false
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { EmergencyType, ResponderStatus } from '@meshsos/shared';
import {
  rankResponders,
  type Responder,
  type ResponderType,
  type RankingConfig,
} from './geo-dispatch.service.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_EMERGENCY_TYPES: EmergencyType[] = ['police', 'medical', 'food', 'childrenElderly'];
const ALL_RESPONDER_TYPES: ResponderType[] = ['police', 'medical', 'rescue', 'relief', 'social'];
const ALL_RESPONDER_STATUSES: ResponderStatus[] = ['available', 'busy', 'assigned', 'enRoute', 'onScene', 'offline'];
const ELIGIBLE_STATUSES: ResponderStatus[] = ['available', 'assigned', 'enRoute', 'onScene'];
const EXCLUDED_STATUSES: ResponderStatus[] = ['busy', 'offline'];

const DEFAULT_STALENESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ─── Arbitraries ────────────────────────────────────────────────────────────

const emergencyTypeArb = fc.constantFrom(...ALL_EMERGENCY_TYPES);
const responderTypeArb = fc.constantFrom(...ALL_RESPONDER_TYPES);
const responderStatusArb = fc.constantFrom(...ALL_RESPONDER_STATUSES);
const regionIdArb = fc.uuid();

/** Generate a latitude in [-90, 90] */
const latitudeArb = fc.double({ min: -90, max: 90, noNaN: true });

/** Generate a longitude in [-180, 180] */
const longitudeArb = fc.double({ min: -180, max: 180, noNaN: true });

/**
 * Generate a location_updated_at timestamp string.
 * Can be recent (within 5 min) or stale (5 min to 60 min ago).
 */
const locationTimestampArb = fc.integer({ min: 0, max: 60 * 60 * 1000 }).map((ageMs) => {
  return new Date(Date.now() - ageMs).toISOString();
});

/**
 * Generate a random Responder object with varying statuses, locations, types, and timestamps.
 */
const responderArb = fc.record({
  id: fc.uuid(),
  user_id: fc.uuid(),
  name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  organization: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  station_id: fc.option(fc.uuid(), { nil: null }),
  region_id: fc.option(fc.uuid(), { nil: null }),
  type: responderTypeArb,
  latitude: fc.option(latitudeArb, { nil: null }),
  longitude: fc.option(longitudeArb, { nil: null }),
  location_updated_at: fc.option(locationTimestampArb, { nil: null }),
  status: responderStatusArb,
  current_incident_id: fc.option(fc.uuid(), { nil: null }),
  vehicle: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  capabilities: fc.constant(null),
  created_at: fc.constant(new Date().toISOString()),
  updated_at: fc.constant(new Date().toISOString()),
}) as fc.Arbitrary<Responder>;

/** Generate a list of 0 to 30 responders */
const respondersListArb = fc.array(responderArb, { minLength: 0, maxLength: 30 });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 21: Responder Ranking Constraints', () => {
  describe('(a) All results have status != busy and != offline', () => {
    it('for any random set of candidates, all ranked results exclude busy and offline responders', () => {
      fc.assert(
        fc.property(
          respondersListArb,
          latitudeArb,
          longitudeArb,
          emergencyTypeArb,
          fc.option(regionIdArb, { nil: null }),
          (candidates, incidentLat, incidentLng, emergencyType, regionId) => {
            const results = rankResponders(
              candidates,
              incidentLat,
              incidentLng,
              emergencyType,
              regionId
            );

            for (const result of results) {
              expect(EXCLUDED_STATUSES).not.toContain(result.status);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('(b) Results are sorted in non-increasing order of suitabilityScore', () => {
    it('for any random set of candidates, results are sorted by score descending', () => {
      fc.assert(
        fc.property(
          respondersListArb,
          latitudeArb,
          longitudeArb,
          emergencyTypeArb,
          fc.option(regionIdArb, { nil: null }),
          (candidates, incidentLat, incidentLng, emergencyType, regionId) => {
            const results = rankResponders(
              candidates,
              incidentLat,
              incidentLng,
              emergencyType,
              regionId
            );

            for (let i = 1; i < results.length; i++) {
              expect(results[i - 1].suitabilityScore).toBeGreaterThanOrEqual(
                results[i].suitabilityScore
              );
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('(c) Results count is at most 10 (default maxResults)', () => {
    it('for any random set of candidates, results never exceed 10 entries', () => {
      fc.assert(
        fc.property(
          respondersListArb,
          latitudeArb,
          longitudeArb,
          emergencyTypeArb,
          fc.option(regionIdArb, { nil: null }),
          (candidates, incidentLat, incidentLng, emergencyType, regionId) => {
            const results = rankResponders(
              candidates,
              incidentLat,
              incidentLng,
              emergencyType,
              regionId
            );

            expect(results.length).toBeLessThanOrEqual(10);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('(d) Tie-breaking: among equal scores, most recent location update comes first', () => {
    it('for candidates with equal scores but different timestamps, the most recent update ranks first', () => {
      fc.assert(
        fc.property(
          latitudeArb,
          longitudeArb,
          emergencyTypeArb,
          fc.option(regionIdArb, { nil: null }),
          fc.array(
            fc.record({
              id: fc.uuid(),
              location_updated_at: fc.integer({ min: 1000, max: 60 * 60 * 1000 }).map((ageMs) =>
                new Date(Date.now() - ageMs).toISOString()
              ),
            }),
            { minLength: 2, maxLength: 10 }
          ),
          (incidentLat, incidentLng, emergencyType, regionId, responderData) => {
            // Create responders that are identical except for location_updated_at
            // This ensures they get the same score so tie-breaking applies
            const baseResponder: Omit<Responder, 'id' | 'location_updated_at'> = {
              user_id: '00000000-0000-0000-0000-000000000001',
              name: 'Test Responder',
              organization: null,
              station_id: null,
              region_id: regionId,
              type: 'police',
              latitude: incidentLat,   // same location as incident → same distance
              longitude: incidentLng,
              status: 'available' as ResponderStatus,
              current_incident_id: null,
              vehicle: null,
              capabilities: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            const candidates: Responder[] = responderData.map((rd) => ({
              ...baseResponder,
              id: rd.id,
              location_updated_at: rd.location_updated_at,
            }));

            const results = rankResponders(
              candidates,
              incidentLat,
              incidentLng,
              emergencyType,
              regionId
            );

            // All candidates are eligible, so results should be non-empty
            expect(results.length).toBeGreaterThan(0);

            // For consecutive results with the same score, the one with lower
            // locationFreshness (more recent update) should come first
            for (let i = 1; i < results.length; i++) {
              if (results[i - 1].suitabilityScore === results[i].suitabilityScore) {
                // Lower freshness value = more recent update
                expect(results[i - 1].locationFreshness).toBeLessThanOrEqual(
                  results[i].locationFreshness
                );
              }
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('(e) Stale responders have isFresh=false', () => {
    it('for any set of candidates, responders with location freshness > threshold have isFresh=false', () => {
      fc.assert(
        fc.property(
          respondersListArb,
          latitudeArb,
          longitudeArb,
          emergencyTypeArb,
          fc.option(regionIdArb, { nil: null }),
          (candidates, incidentLat, incidentLng, emergencyType, regionId) => {
            const stalenessThresholdMs = DEFAULT_STALENESS_THRESHOLD_MS;
            const stalenessThresholdSec = stalenessThresholdMs / 1000;

            const results = rankResponders(
              candidates,
              incidentLat,
              incidentLng,
              emergencyType,
              regionId,
              { stalenessThresholdMs }
            );

            for (const result of results) {
              if (result.locationFreshness > stalenessThresholdSec) {
                expect(result.isFresh).toBe(false);
              }
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('for any set of candidates, responders with location freshness <= threshold have isFresh=true', () => {
      fc.assert(
        fc.property(
          respondersListArb,
          latitudeArb,
          longitudeArb,
          emergencyTypeArb,
          fc.option(regionIdArb, { nil: null }),
          (candidates, incidentLat, incidentLng, emergencyType, regionId) => {
            const stalenessThresholdMs = DEFAULT_STALENESS_THRESHOLD_MS;
            const stalenessThresholdSec = stalenessThresholdMs / 1000;

            const results = rankResponders(
              candidates,
              incidentLat,
              incidentLng,
              emergencyType,
              regionId,
              { stalenessThresholdMs }
            );

            for (const result of results) {
              if (result.locationFreshness <= stalenessThresholdSec) {
                expect(result.isFresh).toBe(true);
              }
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
