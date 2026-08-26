import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Property tests for Region Detection (Property 20)
 *
 * **Validates: Requirements 29.1, 29.3**
 *
 * For any GPS coordinates that fall within exactly one defined region boundary,
 * the Geo Dispatch Engine SHALL return that region. For any coordinates that fall
 * outside all boundaries, the system SHALL assign "unresolved region" status.
 */

// Mock the database module before importing the service
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
}));

import { detectRegion, isValidCoordinate } from './geo-dispatch.service.js';
import { query } from '../db/index.js';

const mockedQuery = vi.mocked(query);

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Valid latitude in [-90, 90] */
const validLatArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });

/** Valid longitude in [-180, 180] */
const validLngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

/** Invalid latitude outside [-90, 90] (but still finite) */
const outOfRangeLatArb = fc.oneof(
  fc.double({ min: 90.0001, max: 1000, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -1000, max: -90.0001, noNaN: true, noDefaultInfinity: true })
);

/** Invalid longitude outside [-180, 180] (but still finite) */
const outOfRangeLngArb = fc.oneof(
  fc.double({ min: 180.0001, max: 1000, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -1000, max: -180.0001, noNaN: true, noDefaultInfinity: true })
);

/** Null or undefined values for coordinates */
const nullishArb = fc.constantFrom(null, undefined);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 20: Region Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidCoordinate returns true iff lat in [-90,90] AND lng in [-180,180] AND both are finite numbers', () => {
    it('returns true for any valid coordinate pair', () => {
      fc.assert(
        fc.property(validLatArb, validLngArb, (lat, lng) => {
          expect(isValidCoordinate(lat, lng)).toBe(true);
        }),
        { numRuns: 500 }
      );
    });

    it('returns false for any null/undefined latitude', () => {
      fc.assert(
        fc.property(nullishArb, validLngArb, (lat, lng) => {
          expect(isValidCoordinate(lat, lng)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('returns false for any null/undefined longitude', () => {
      fc.assert(
        fc.property(validLatArb, nullishArb, (lat, lng) => {
          expect(isValidCoordinate(lat, lng)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('returns false for NaN latitude or longitude', () => {
      fc.assert(
        fc.property(validLngArb, (lng) => {
          expect(isValidCoordinate(NaN, lng)).toBe(false);
        }),
        { numRuns: 100 }
      );
      fc.assert(
        fc.property(validLatArb, (lat) => {
          expect(isValidCoordinate(lat, NaN)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('returns false for Infinity latitude or longitude', () => {
      fc.assert(
        fc.property(validLngArb, (lng) => {
          expect(isValidCoordinate(Infinity, lng)).toBe(false);
          expect(isValidCoordinate(-Infinity, lng)).toBe(false);
        }),
        { numRuns: 100 }
      );
      fc.assert(
        fc.property(validLatArb, (lat) => {
          expect(isValidCoordinate(lat, Infinity)).toBe(false);
          expect(isValidCoordinate(lat, -Infinity)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('returns false for out-of-range latitude', () => {
      fc.assert(
        fc.property(outOfRangeLatArb, validLngArb, (lat, lng) => {
          expect(isValidCoordinate(lat, lng)).toBe(false);
        }),
        { numRuns: 200 }
      );
    });

    it('returns false for out-of-range longitude', () => {
      fc.assert(
        fc.property(validLatArb, outOfRangeLngArb, (lat, lng) => {
          expect(isValidCoordinate(lat, lng)).toBe(false);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('detectRegion returns unresolved_location for null/undefined/NaN coordinates', () => {
    it('for any null latitude or longitude, returns unresolved_location', () => {
      fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // null lat, any lng
            fc.tuple(fc.constant(null), fc.oneof(validLngArb, fc.constant(null))),
            // any lat, null lng
            fc.tuple(fc.oneof(validLatArb, fc.constant(null)), fc.constant(null))
          ),
          async ([lat, lng]) => {
            const result = await detectRegion(lat, lng);
            expect(result.status).toBe('unresolved_location');
            expect(result.regionId).toBeNull();
            expect(result.regionName).toBeNull();
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('detectRegion returns unresolved_location for out-of-range coordinates', () => {
    it('for any lat > 90 or lat < -90 or lng > 180 or lng < -180, returns unresolved_location', () => {
      fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Out-of-range lat with any lng
            fc.tuple(outOfRangeLatArb, validLngArb),
            // Valid lat with out-of-range lng
            fc.tuple(validLatArb, outOfRangeLngArb),
            // Both out of range
            fc.tuple(outOfRangeLatArb, outOfRangeLngArb)
          ),
          async ([lat, lng]) => {
            const result = await detectRegion(lat as number | null, lng as number | null);
            expect(result.status).toBe('unresolved_location');
            expect(result.regionId).toBeNull();
            expect(result.regionName).toBeNull();
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('detectRegion returns resolved or unresolved_region for valid coordinates (never unresolved_location)', () => {
    it('for any valid coordinates, detectRegion returns either resolved or unresolved_region', () => {
      // Mock: 50% of the time return a region, 50% return empty results
      let callCount = 0;
      mockedQuery.mockImplementation(async () => {
        callCount++;
        if (callCount % 2 === 0) {
          // Simulate a region match
          return {
            rows: [{ id: 'region-uuid-123', name: 'Test Region' }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          } as any;
        }
        // Simulate no region match
        return {
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        } as any;
      });

      fc.assert(
        fc.asyncProperty(validLatArb, validLngArb, async (lat, lng) => {
          const result = await detectRegion(lat, lng);

          // Must NEVER return unresolved_location for valid coordinates
          expect(result.status).not.toBe('unresolved_location');

          // Must be one of resolved or unresolved_region
          expect(['resolved', 'unresolved_region']).toContain(result.status);

          // If resolved, must have region details
          if (result.status === 'resolved') {
            expect(result.regionId).not.toBeNull();
            expect(result.regionName).not.toBeNull();
          }

          // If unresolved_region, region fields should be null
          if (result.status === 'unresolved_region') {
            expect(result.regionId).toBeNull();
            expect(result.regionName).toBeNull();
          }
        }),
        { numRuns: 500 }
      );
    });

    it('when DB returns a region row, detectRegion returns resolved with that region', () => {
      const regionIdArb = fc.uuid();
      const regionNameArb = fc.string({ minLength: 1, maxLength: 50 });

      fc.assert(
        fc.asyncProperty(
          validLatArb,
          validLngArb,
          regionIdArb,
          regionNameArb,
          async (lat, lng, regionId, regionName) => {
            mockedQuery.mockResolvedValueOnce({
              rows: [{ id: regionId, name: regionName }],
              rowCount: 1,
              command: 'SELECT',
              oid: 0,
              fields: [],
            } as any);

            const result = await detectRegion(lat, lng);

            expect(result.status).toBe('resolved');
            expect(result.regionId).toBe(regionId);
            expect(result.regionName).toBe(regionName);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('when DB returns no rows, detectRegion returns unresolved_region', () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any);

      fc.assert(
        fc.asyncProperty(validLatArb, validLngArb, async (lat, lng) => {
          const result = await detectRegion(lat, lng);

          expect(result.status).toBe('unresolved_region');
          expect(result.regionId).toBeNull();
          expect(result.regionName).toBeNull();
        }),
        { numRuns: 200 }
      );
    });

    it('when DB throws an error, detectRegion returns unresolved_region (not unresolved_location)', () => {
      mockedQuery.mockRejectedValue(new Error('Connection timeout'));

      fc.assert(
        fc.asyncProperty(validLatArb, validLngArb, async (lat, lng) => {
          const result = await detectRegion(lat, lng);

          expect(result.status).toBe('unresolved_region');
          expect(result.regionId).toBeNull();
          expect(result.regionName).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });
});
