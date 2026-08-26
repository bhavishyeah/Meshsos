/**
 * Unit tests for Geo Dispatch Service — emergency-type responder routing.
 *
 * Tests getResponderPool() and EMERGENCY_TYPE_ROUTING mapping:
 * - Correct responder types are queried for each emergency type
 * - Busy and offline responders are excluded
 * - Region filtering works via station join
 * - Empty results handled correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import {
  getResponderPool,
  EMERGENCY_TYPE_ROUTING,
  haversineDistance,
  rankResponders,
  type Responder,
  type ResponderType,
  type RankingConfig,
  type RankedResponderResult,
} from './geo-dispatch.service.js';
import { query } from '../db/index.js';

const mockQuery = vi.mocked(query);

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeResponder(overrides: Partial<Responder> = {}): Responder {
  return {
    id: 'resp-001',
    user_id: 'user-001',
    name: 'Officer Smith',
    organization: 'City Police',
    station_id: 'station-001',
    region_id: 'region-abc-123',
    type: 'police',
    latitude: 28.6139,
    longitude: 77.209,
    location_updated_at: '2024-01-15T10:00:00Z',
    status: 'available',
    current_incident_id: null,
    vehicle: 'patrol-car-1',
    capabilities: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

const REGION_ID = 'region-abc-123';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Geo Dispatch Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('EMERGENCY_TYPE_ROUTING', () => {
    it('maps police emergency to police and rescue responder types', () => {
      expect(EMERGENCY_TYPE_ROUTING.police).toEqual(['police', 'rescue']);
    });

    it('maps medical emergency to medical responder type', () => {
      expect(EMERGENCY_TYPE_ROUTING.medical).toEqual(['medical']);
    });

    it('maps food emergency to relief responder type', () => {
      expect(EMERGENCY_TYPE_ROUTING.food).toEqual(['relief']);
    });

    it('maps childrenElderly emergency to social, police, and medical responder types', () => {
      expect(EMERGENCY_TYPE_ROUTING.childrenElderly).toEqual(['social', 'police', 'medical']);
    });

    it('covers all four emergency types', () => {
      const types = Object.keys(EMERGENCY_TYPE_ROUTING);
      expect(types).toHaveLength(4);
      expect(types).toContain('police');
      expect(types).toContain('medical');
      expect(types).toContain('food');
      expect(types).toContain('childrenElderly');
    });
  });

  describe('getResponderPool()', () => {
    it('queries responders with correct region, types, and status filters for police emergency', async () => {
      const policeResponder = makeResponder({ type: 'police' });
      const rescueResponder = makeResponder({ id: 'resp-002', type: 'rescue' });

      mockQuery.mockResolvedValueOnce({
        rows: [policeResponder, rescueResponder],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getResponderPool(REGION_ID, 'police');

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('police');
      expect(result[1].type).toBe('rescue');

      // Verify the query was called with correct parameters
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];

      // Check region parameter
      expect(params![0]).toBe(REGION_ID);
      // Check excluded statuses
      expect(params).toContain('busy');
      expect(params).toContain('offline');
      // Check responder types
      expect(params).toContain('police');
      expect(params).toContain('rescue');

      // Verify SQL structure
      expect(sql).toContain('s.region_id = $1');
      expect(sql).toContain('r.status NOT IN');
      expect(sql).toContain('r.type IN');
      expect(sql).toContain('INNER JOIN stations s ON r.station_id = s.id');
    });

    it('queries correct responder types for medical emergency', async () => {
      const medicalResponder = makeResponder({ id: 'resp-003', type: 'medical' });

      mockQuery.mockResolvedValueOnce({
        rows: [medicalResponder],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getResponderPool(REGION_ID, 'medical');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('medical');

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toContain('medical');
      // Should NOT contain other responder types
      expect(params).not.toContain('police');
      expect(params).not.toContain('rescue');
      expect(params).not.toContain('relief');
      expect(params).not.toContain('social');
    });

    it('queries correct responder types for food emergency', async () => {
      const reliefResponder = makeResponder({ id: 'resp-004', type: 'relief' });

      mockQuery.mockResolvedValueOnce({
        rows: [reliefResponder],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getResponderPool(REGION_ID, 'food');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('relief');

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toContain('relief');
      expect(params).not.toContain('police');
      expect(params).not.toContain('medical');
    });

    it('queries correct responder types for childrenElderly emergency', async () => {
      const socialResponder = makeResponder({ id: 'resp-005', type: 'social' });
      const policeResponder = makeResponder({ id: 'resp-006', type: 'police' });
      const medicalResponder = makeResponder({ id: 'resp-007', type: 'medical' });

      mockQuery.mockResolvedValueOnce({
        rows: [socialResponder, policeResponder, medicalResponder],
        rowCount: 3,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getResponderPool(REGION_ID, 'childrenElderly');

      expect(result).toHaveLength(3);
      expect(result.map(r => r.type)).toEqual(['social', 'police', 'medical']);

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toContain('social');
      expect(params).toContain('police');
      expect(params).toContain('medical');
    });

    it('returns empty array when no responders match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await getResponderPool(REGION_ID, 'medical');

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('excludes busy and offline responders via SQL query parameters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await getResponderPool(REGION_ID, 'police');

      const [sql, params] = mockQuery.mock.calls[0];

      // The SQL should filter out busy and offline statuses
      expect(sql).toContain('r.status NOT IN');
      expect(params![1]).toBe('busy');
      expect(params![2]).toBe('offline');
    });

    it('uses correct parameterized placeholders to prevent SQL injection', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Use a region ID that looks like an injection attempt
      const maliciousRegionId = "'; DROP TABLE responders; --";
      await getResponderPool(maliciousRegionId, 'police');

      const [, params] = mockQuery.mock.calls[0];
      // The malicious string should be passed as a parameter, not injected into SQL
      expect(params![0]).toBe(maliciousRegionId);
    });

    it('passes regionId as the first query parameter', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const specificRegion = 'region-xyz-789';
      await getResponderPool(specificRegion, 'food');

      const [, params] = mockQuery.mock.calls[0];
      expect(params![0]).toBe(specificRegion);
    });

    it('joins with stations table to filter by region', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await getResponderPool(REGION_ID, 'medical');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('INNER JOIN stations s ON r.station_id = s.id');
      expect(sql).toContain('s.region_id = $1');
    });

    it('selects responder location using PostGIS ST_Y and ST_X', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await getResponderPool(REGION_ID, 'police');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('ST_Y(r.current_location::geometry) as latitude');
      expect(sql).toContain('ST_X(r.current_location::geometry) as longitude');
    });

    it('propagates database errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(getResponderPool(REGION_ID, 'police')).rejects.toThrow('Connection refused');
    });
  });
});


// ─── Haversine Distance Tests ─────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    const dist = haversineDistance(28.6139, 77.209, 28.6139, 77.209);
    expect(dist).toBe(0);
  });

  it('calculates correct distance between known cities (New Delhi to Mumbai ~1150km)', () => {
    // New Delhi: 28.6139, 77.2090
    // Mumbai: 19.0760, 72.8777
    const dist = haversineDistance(28.6139, 77.209, 19.076, 72.8777);
    // Should be approximately 1150 km (accepted range: 1100-1200)
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1200);
  });

  it('calculates correct distance between known cities (London to Paris ~344km)', () => {
    // London: 51.5074, -0.1278
    // Paris: 48.8566, 2.3522
    const dist = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(360);
  });

  it('is symmetric (distance A→B equals B→A)', () => {
    const distAB = haversineDistance(28.6139, 77.209, 19.076, 72.8777);
    const distBA = haversineDistance(19.076, 72.8777, 28.6139, 77.209);
    expect(distAB).toBeCloseTo(distBA, 10);
  });

  it('handles antipodal points (max distance ~20015 km)', () => {
    // North pole to south pole
    const dist = haversineDistance(90, 0, -90, 0);
    expect(dist).toBeGreaterThan(20000);
    expect(dist).toBeLessThan(20050);
  });

  it('handles points on the equator', () => {
    // Two points 1 degree apart on the equator (~111 km)
    const dist = haversineDistance(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(112);
  });

  it('handles negative longitudes (across prime meridian)', () => {
    const dist = haversineDistance(51.5, -3.0, 51.5, 3.0);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(500);
  });
});

// ─── Responder Ranking Algorithm Tests ──────────────────────────────────────

describe('rankResponders', () => {
  const INCIDENT_LAT = 28.6139;
  const INCIDENT_LNG = 77.209;
  const REGION_ID = 'region-abc-123';
  const NOW = Date.now();

  function freshTimestamp(secondsAgo: number): string {
    return new Date(NOW - secondsAgo * 1000).toISOString();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Filtering (Requirements 31.2)', () => {
    it('excludes responders with status "busy"', () => {
      const candidates = [
        makeResponder({ id: 'r1', status: 'busy', location_updated_at: freshTimestamp(60) }),
        makeResponder({ id: 'r2', status: 'available', location_updated_at: freshTimestamp(60) }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results).toHaveLength(1);
      expect(results[0].responderId).toBe('r2');
    });

    it('excludes responders with status "offline"', () => {
      const candidates = [
        makeResponder({ id: 'r1', status: 'offline', location_updated_at: freshTimestamp(60) }),
        makeResponder({ id: 'r2', status: 'available', location_updated_at: freshTimestamp(60) }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results).toHaveLength(1);
      expect(results[0].responderId).toBe('r2');
    });

    it('keeps responders with status "available", "assigned", "enRoute", "onScene"', () => {
      const candidates = [
        makeResponder({ id: 'r1', status: 'available', location_updated_at: freshTimestamp(60) }),
        makeResponder({ id: 'r2', status: 'assigned', location_updated_at: freshTimestamp(60) }),
        makeResponder({ id: 'r3', status: 'enRoute', location_updated_at: freshTimestamp(60) }),
        makeResponder({ id: 'r4', status: 'onScene', location_updated_at: freshTimestamp(60) }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results).toHaveLength(4);
    });

    it('returns empty array when all candidates are busy or offline', () => {
      const candidates = [
        makeResponder({ id: 'r1', status: 'busy' }),
        makeResponder({ id: 'r2', status: 'offline' }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results).toHaveLength(0);
    });
  });

  describe('Location Freshness (Requirements 32.1, 32.2)', () => {
    it('flags responder as fresh when within staleness threshold', () => {
      const candidates = [
        makeResponder({ id: 'r1', location_updated_at: freshTimestamp(60) }), // 1 min ago
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].isFresh).toBe(true);
      expect(results[0].locationFreshness).toBe(60);
    });

    it('flags responder as stale when beyond staleness threshold', () => {
      const candidates = [
        makeResponder({ id: 'r1', location_updated_at: freshTimestamp(400) }), // 6+ min ago
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].isFresh).toBe(false);
    });

    it('treats missing location_updated_at as stale', () => {
      const candidates = [
        makeResponder({ id: 'r1', location_updated_at: null }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].isFresh).toBe(false);
    });

    it('uses custom staleness threshold from config', () => {
      const candidates = [
        makeResponder({ id: 'r1', location_updated_at: freshTimestamp(120) }), // 2 min ago
      ];

      // Set threshold to 1 minute — responder should be stale
      const results = rankResponders(
        candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID,
        { stalenessThresholdMs: 60 * 1000 }
      );

      expect(results[0].isFresh).toBe(false);
    });
  });

  describe('Haversine Distance Calculation', () => {
    it('calculates distance between incident and responder', () => {
      const candidates = [
        makeResponder({
          id: 'r1',
          latitude: 28.7041, // ~10km north of incident
          longitude: 77.1025,
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].distanceKm).toBeGreaterThan(0);
      expect(results[0].distanceKm).toBeLessThan(20);
    });

    it('handles responder with null coordinates', () => {
      const candidates = [
        makeResponder({ id: 'r1', latitude: null, longitude: null, location_updated_at: freshTimestamp(30) }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].distanceKm).toBe(-1); // -1 indicates unknown distance
    });
  });

  describe('Scoring Components', () => {
    it('gives higher score to closer responder (distance weight)', () => {
      const candidates = [
        makeResponder({
          id: 'close',
          latitude: INCIDENT_LAT + 0.01, // very close
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
        makeResponder({
          id: 'far',
          latitude: INCIDENT_LAT + 1.0, // ~111km away
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      const closeResult = results.find(r => r.responderId === 'close')!;
      const farResult = results.find(r => r.responderId === 'far')!;
      expect(closeResult.suitabilityScore).toBeGreaterThan(farResult.suitabilityScore);
    });

    it('gives higher type match score to matching responder type', () => {
      const candidates = [
        makeResponder({
          id: 'match',
          type: 'police',
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
        makeResponder({
          id: 'nomatch',
          type: 'relief', // not a police match
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      const matchResult = results.find(r => r.responderId === 'match')!;
      const noMatchResult = results.find(r => r.responderId === 'nomatch')!;
      expect(matchResult.suitabilityScore).toBeGreaterThan(noMatchResult.suitabilityScore);
    });

    it('gives higher freshness score to responder with more recent location', () => {
      const candidates = [
        makeResponder({
          id: 'fresh',
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(10), // 10s ago
        }),
        makeResponder({
          id: 'lessfreash',
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(250), // 250s ago (within 300s threshold)
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      const freshResult = results.find(r => r.responderId === 'fresh')!;
      const lessFreshResult = results.find(r => r.responderId === 'lessfreash')!;
      expect(freshResult.suitabilityScore).toBeGreaterThan(lessFreshResult.suitabilityScore);
    });

    it('gives 0 freshness score to stale responders', () => {
      const candidates = [
        makeResponder({
          id: 'stale',
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(400), // 400s ago, beyond 300s
        }),
      ];

      // Give full freshness weight to make it measurable
      const config: RankingConfig = {
        weights: { distance: 0, typeMatch: 0, freshness: 1.0, jurisdiction: 0 },
      };

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID, config);

      expect(results[0].suitabilityScore).toBe(0);
    });

    it('gives higher jurisdiction score to same-region responder', () => {
      const candidates = [
        makeResponder({
          id: 'sameRegion',
          region_id: REGION_ID,
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
        makeResponder({
          id: 'diffRegion',
          region_id: 'other-region-456',
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      const sameResult = results.find(r => r.responderId === 'sameRegion')!;
      const diffResult = results.find(r => r.responderId === 'diffRegion')!;
      expect(sameResult.suitabilityScore).toBeGreaterThan(diffResult.suitabilityScore);
    });
  });

  describe('Sorting and Tie-Breaking (Requirement 31.6)', () => {
    it('sorts by score descending', () => {
      const candidates = [
        makeResponder({
          id: 'low',
          latitude: INCIDENT_LAT + 2.0, // far away → lower score
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
        makeResponder({
          id: 'high',
          latitude: INCIDENT_LAT + 0.01, // close → higher score
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].responderId).toBe('high');
      expect(results[1].responderId).toBe('low');
      expect(results[0].suitabilityScore).toBeGreaterThan(results[1].suitabilityScore);
    });

    it('breaks ties by most recent location update', () => {
      // Same location, same type, same region → same score but different location timestamps
      const candidates = [
        makeResponder({
          id: 'older',
          latitude: INCIDENT_LAT,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(120), // 2 min ago
        }),
        makeResponder({
          id: 'newer',
          latitude: INCIDENT_LAT,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30), // 30s ago
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      // Newer location update should come first in tie-break
      expect(results[0].responderId).toBe('newer');
      expect(results[1].responderId).toBe('older');
    });
  });

  describe('Max Results (Requirement 31.1)', () => {
    it('returns at most 10 results by default', () => {
      const candidates = Array.from({ length: 15 }, (_, i) =>
        makeResponder({
          id: `r${i}`,
          latitude: INCIDENT_LAT + 0.01 * (i + 1),
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        })
      );

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results).toHaveLength(10);
    });

    it('returns fewer than maxResults if fewer eligible candidates', () => {
      const candidates = [
        makeResponder({ id: 'r1', location_updated_at: freshTimestamp(30) }),
        makeResponder({ id: 'r2', location_updated_at: freshTimestamp(30) }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results).toHaveLength(2);
    });

    it('respects custom maxResults config', () => {
      const candidates = Array.from({ length: 8 }, (_, i) =>
        makeResponder({
          id: `r${i}`,
          latitude: INCIDENT_LAT + 0.01 * (i + 1),
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(30),
        })
      );

      const results = rankResponders(
        candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID,
        { maxResults: 3 }
      );

      expect(results).toHaveLength(3);
    });
  });

  describe('Result Shape', () => {
    it('returns correct fields in result objects', () => {
      const candidates = [
        makeResponder({
          id: 'r1',
          name: 'Officer Johnson',
          status: 'available',
          latitude: INCIDENT_LAT + 0.05,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(60),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0]).toEqual(expect.objectContaining({
        responderId: 'r1',
        name: 'Officer Johnson',
        status: 'available',
        isFresh: true,
      }));
      expect(results[0].distanceKm).toBeGreaterThan(0);
      expect(results[0].locationFreshness).toBe(60);
      expect(results[0].suitabilityScore).toBeGreaterThan(0);
    });

    it('uses organization name when name is null', () => {
      const candidates = [
        makeResponder({
          id: 'r1',
          name: null,
          organization: 'Fire Department',
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].name).toBe('Fire Department');
    });

    it('uses "Unknown" when both name and organization are null', () => {
      const candidates = [
        makeResponder({
          id: 'r1',
          name: null,
          organization: null,
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].name).toBe('Unknown');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty candidate array', () => {
      const results = rankResponders([], INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);
      expect(results).toHaveLength(0);
    });

    it('handles null regionId (gives partial jurisdiction score)', () => {
      const candidates = [
        makeResponder({
          id: 'r1',
          region_id: 'some-region',
          location_updated_at: freshTimestamp(30),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', null);

      expect(results).toHaveLength(1);
      expect(results[0].suitabilityScore).toBeGreaterThan(0);
    });

    it('handles responder at exact same location as incident', () => {
      const candidates = [
        makeResponder({
          id: 'r1',
          latitude: INCIDENT_LAT,
          longitude: INCIDENT_LNG,
          location_updated_at: freshTimestamp(10),
        }),
      ];

      const results = rankResponders(candidates, INCIDENT_LAT, INCIDENT_LNG, 'police', REGION_ID);

      expect(results[0].distanceKm).toBe(0);
      // Distance score should be 1/(1+0) * 0.4 = 0.4 (max distance score)
    });
  });
});
