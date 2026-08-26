import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateCoordinates } from './station.service.js';

/**
 * Property 28: Facility Coordinate Validation
 *
 * **Validates: Requirements 27.4**
 *
 * Generate random coordinate inputs and verify validation rejects out-of-range
 * and accepts valid WGS84 coordinates.
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Valid latitude in [-90, 90] */
const validLatArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });

/** Valid longitude in [-180, 180] */
const validLngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

/** Invalid latitude outside [-90, 90] (finite, not NaN) */
const outOfRangeLatArb = fc.oneof(
  fc.double({ min: 90.0001, max: 10000, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -10000, max: -90.0001, noNaN: true, noDefaultInfinity: true })
);

/** Invalid longitude outside [-180, 180] (finite, not NaN) */
const outOfRangeLngArb = fc.oneof(
  fc.double({ min: 180.0001, max: 10000, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -10000, max: -180.0001, noNaN: true, noDefaultInfinity: true })
);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 28: Facility Coordinate Validation', () => {
  it('accepts any valid WGS84 coordinates (lat in [-90,90], lng in [-180,180])', () => {
    fc.assert(
      fc.property(validLatArb, validLngArb, (lat, lng) => {
        expect(validateCoordinates(lat, lng)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('rejects any latitude outside [-90, 90]', () => {
    fc.assert(
      fc.property(outOfRangeLatArb, validLngArb, (lat, lng) => {
        expect(validateCoordinates(lat, lng)).toBe(false);
      }),
      { numRuns: 500 }
    );
  });

  it('rejects any longitude outside [-180, 180]', () => {
    fc.assert(
      fc.property(validLatArb, outOfRangeLngArb, (lat, lng) => {
        expect(validateCoordinates(lat, lng)).toBe(false);
      }),
      { numRuns: 500 }
    );
  });

  it('rejects NaN latitude or longitude', () => {
    fc.assert(
      fc.property(validLngArb, (lng) => {
        expect(validateCoordinates(NaN, lng)).toBe(false);
      }),
      { numRuns: 100 }
    );

    fc.assert(
      fc.property(validLatArb, (lat) => {
        expect(validateCoordinates(lat, NaN)).toBe(false);
      }),
      { numRuns: 100 }
    );

    // Both NaN
    expect(validateCoordinates(NaN, NaN)).toBe(false);
  });
});
