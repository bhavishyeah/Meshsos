/**
 * Property tests for Emergency-Type Routing (Property 19)
 *
 * **Validates: Requirements 30.1, 30.2, 30.3, 30.4**
 *
 * For any SOS with a determined region, the Geo Dispatch Engine SHALL route to the
 * correct responder pool based on emergency type:
 * - Police/Rescue → police officers, rescue teams, disaster response
 * - Medical → ambulances, medical responders, hospitals
 * - Food/Water → relief teams, local administration, distribution centers
 * - Children/Elderly → social-response teams, police, medical services
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { EmergencyType } from '@meshsos/shared';

// Mock the database module before importing the service
const mockQuery = vi.fn();
vi.mock('../db/index.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock setup
import {
  EMERGENCY_TYPE_ROUTING,
  getResponderPool,
  type ResponderType,
} from './geo-dispatch.service.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_EMERGENCY_TYPES: EmergencyType[] = ['police', 'medical', 'food', 'childrenElderly'];
const ALL_RESPONDER_TYPES: ResponderType[] = ['police', 'medical', 'rescue', 'relief', 'social'];

// ─── Arbitraries ────────────────────────────────────────────────────────────

const emergencyTypeArb = fc.constantFrom(...ALL_EMERGENCY_TYPES);
const regionIdArb = fc.uuid();

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 19: Emergency-Type Routing', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('EMERGENCY_TYPE_ROUTING maps every emergency type to a non-empty array of valid ResponderType values', () => {
    it('for any random emergency type, EMERGENCY_TYPE_ROUTING[type] is a non-empty array of valid ResponderType values', () => {
      fc.assert(
        fc.property(emergencyTypeArb, (emergencyType) => {
          const routing = EMERGENCY_TYPE_ROUTING[emergencyType];

          // Must be a non-empty array
          expect(Array.isArray(routing)).toBe(true);
          expect(routing.length).toBeGreaterThan(0);

          // Every element must be a valid ResponderType
          for (const responderType of routing) {
            expect(ALL_RESPONDER_TYPES).toContain(responderType);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('getResponderPool queries the DB for exactly the responder types in EMERGENCY_TYPE_ROUTING[type]', () => {
    it('for any random emergency type, getResponderPool queries for exactly the mapped responder types', () => {
      return fc.assert(
        fc.asyncProperty(regionIdArb, emergencyTypeArb, async (regionId, emergencyType) => {
          mockQuery.mockClear();
          mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

          await getResponderPool(regionId, emergencyType);

          expect(mockQuery).toHaveBeenCalledTimes(1);
          const [_sql, params] = mockQuery.mock.calls[0];

          // The expected responder types from the routing map
          const expectedTypes = EMERGENCY_TYPE_ROUTING[emergencyType];

          // params layout: [regionId, ...excludedStatuses, ...responderTypes]
          // $1 = regionId, $2 = 'busy', $3 = 'offline', $4+ = responder types
          const queryResponderTypes = params.slice(3);

          // The query should include exactly the responder types from the routing map
          expect(queryResponderTypes).toHaveLength(expectedTypes.length);
          expect(queryResponderTypes.sort()).toEqual([...expectedTypes].sort());
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Police emergency type always routes to police and rescue responder types', () => {
    it('for police emergency type, the pool always includes police and rescue types', () => {
      fc.assert(
        fc.property(fc.constant('police' as EmergencyType), (emergencyType) => {
          const routing = EMERGENCY_TYPE_ROUTING[emergencyType];

          expect(routing).toContain('police');
          expect(routing).toContain('rescue');
          expect(routing).toHaveLength(2);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Medical emergency type always routes to only medical responder type', () => {
    it('for medical emergency type, the pool always includes only medical type', () => {
      fc.assert(
        fc.property(fc.constant('medical' as EmergencyType), (emergencyType) => {
          const routing = EMERGENCY_TYPE_ROUTING[emergencyType];

          expect(routing).toContain('medical');
          expect(routing).toHaveLength(1);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Food emergency type always routes to only relief responder type', () => {
    it('for food emergency type, the pool always includes only relief type', () => {
      fc.assert(
        fc.property(fc.constant('food' as EmergencyType), (emergencyType) => {
          const routing = EMERGENCY_TYPE_ROUTING[emergencyType];

          expect(routing).toContain('relief');
          expect(routing).toHaveLength(1);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('ChildrenElderly emergency type always routes to social, police, and medical responder types', () => {
    it('for childrenElderly emergency type, the pool always includes social, police, and medical types', () => {
      fc.assert(
        fc.property(fc.constant('childrenElderly' as EmergencyType), (emergencyType) => {
          const routing = EMERGENCY_TYPE_ROUTING[emergencyType];

          expect(routing).toContain('social');
          expect(routing).toContain('police');
          expect(routing).toContain('medical');
          expect(routing).toHaveLength(3);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('getResponderPool always excludes busy and offline statuses', () => {
    it('for any random emergency type, the query always excludes busy and offline statuses', () => {
      return fc.assert(
        fc.asyncProperty(regionIdArb, emergencyTypeArb, async (regionId, emergencyType) => {
          mockQuery.mockClear();
          mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

          await getResponderPool(regionId, emergencyType);

          expect(mockQuery).toHaveBeenCalledTimes(1);
          const [sql, params] = mockQuery.mock.calls[0];

          // The SQL should contain NOT IN clause for status exclusion
          expect(sql).toContain('NOT IN');

          // params[1] and params[2] should be the excluded statuses
          expect(params[1]).toBe('busy');
          expect(params[2]).toBe('offline');
        }),
        { numRuns: 200 }
      );
    });
  });
});
