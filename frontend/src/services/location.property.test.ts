import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { db } from '../db';
import { locationService } from './location.service';

/**
 * Property 3: Location Age Threshold
 *
 * For any last-known location with an age value, the system SHALL use it as the
 * SOS location if and only if the age is less than or equal to 30 minutes.
 * Locations older than 30 minutes SHALL be treated as unavailable.
 *
 * **Validates: Requirements 2.3, 2.4**
 */

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/** Arbitrary for valid latitude values [-90, 90] */
const arbLatitude = fc.double({ min: -90, max: 90, noNaN: true });

/** Arbitrary for valid longitude values [-180, 180] */
const arbLongitude = fc.double({ min: -180, max: 180, noNaN: true });

/** Arbitrary for accuracy in meters (positive) */
const arbAccuracy = fc.double({ min: 0.1, max: 10000, noNaN: true });

/** Arbitrary for a valid GeolocationPosition */
const arbGeolocationPosition = fc.record({
  latitude: arbLatitude,
  longitude: arbLongitude,
  accuracy: arbAccuracy,
  timestamp: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
});

/**
 * Helper: stub navigator.geolocation to succeed with the given position.
 */
function stubGPSSuccess(pos: { latitude: number; longitude: number; accuracy: number; timestamp: number }) {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => {
        success({
          coords: {
            latitude: pos.latitude,
            longitude: pos.longitude,
            accuracy: pos.accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: pos.timestamp,
        } as GeolocationPosition);
      },
    },
  });
}

/**
 * Helper: stub navigator.geolocation to fail with POSITION_UNAVAILABLE.
 */
function stubGPSFailure() {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 2,
          message: 'Position unavailable',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      },
    },
  });
}

describe('Property 3: Location Age Threshold', () => {
  beforeEach(async () => {
    await db.open();
    await db.locations.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('when GPS succeeds with any valid position, the result has method="live"', async () => {
    await fc.assert(
      fc.asyncProperty(arbGeolocationPosition, async (pos) => {
        await db.locations.clear();
        stubGPSSuccess(pos);

        const result = await locationService.getCurrentLocation();

        expect(result).not.toBeNull();
        expect(result!.method).toBe('live');
        expect(result!.latitude).toBe(pos.latitude);
        expect(result!.longitude).toBe(pos.longitude);
        expect(result!.accuracy).toBe(pos.accuracy);
      }),
      { numRuns: 50 },
    );
  });

  it('when GPS fails and a stored location within 30 minutes exists, the result has method="lastKnown"', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbLatitude,
        arbLongitude,
        arbAccuracy,
        // Age in ms: 0 to 30 minutes (inclusive, within threshold)
        fc.integer({ min: 0, max: THIRTY_MINUTES_MS }),
        async (lat, lng, accuracy, ageMs) => {
          await db.locations.clear();

          const now = Date.now();

          // Store a location that is `ageMs` old
          const locationTimestamp = new Date(now - ageMs);
          await locationService.storeLocation({
            latitude: lat,
            longitude: lng,
            accuracy,
            timestamp: locationTimestamp,
            method: 'live',
          });

          // Mock Date.now for the threshold check
          vi.spyOn(Date, 'now').mockReturnValue(now);

          stubGPSFailure();

          const result = await locationService.getCurrentLocation();

          expect(result).not.toBeNull();
          expect(result!.method).toBe('lastKnown');
          expect(result!.latitude).toBe(lat);
          expect(result!.longitude).toBe(lng);
          expect(result!.accuracy).toBe(accuracy);
          expect(result!.timestamp).toEqual(locationTimestamp);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('when GPS fails and the stored location is older than 30 minutes, the result is null', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbLatitude,
        arbLongitude,
        arbAccuracy,
        // Age in ms: just over 30 minutes up to 24 hours
        fc.integer({ min: THIRTY_MINUTES_MS + 1, max: 24 * 60 * 60 * 1000 }),
        async (lat, lng, accuracy, ageMs) => {
          await db.locations.clear();

          const now = Date.now();

          // Store a location that is older than 30 minutes
          const locationTimestamp = new Date(now - ageMs);
          await locationService.storeLocation({
            latitude: lat,
            longitude: lng,
            accuracy,
            timestamp: locationTimestamp,
            method: 'live',
          });

          // Mock Date.now for the threshold check
          vi.spyOn(Date, 'now').mockReturnValue(now);

          stubGPSFailure();

          const result = await locationService.getCurrentLocation();

          // Location older than 30 minutes should be treated as unavailable
          expect(result).toBeNull();

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('when GPS fails and no stored location exists, the result is null', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random scenarios to verify no stored data means null
        fc.integer({ min: 1, max: 100 }),
        async () => {
          await db.locations.clear();
          stubGPSFailure();

          const result = await locationService.getCurrentLocation();

          expect(result).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('the returned timestamp is always a Date object when result is non-null', async () => {
    await fc.assert(
      fc.asyncProperty(arbGeolocationPosition, async (pos) => {
        await db.locations.clear();
        stubGPSSuccess(pos);

        const result = await locationService.getCurrentLocation();

        expect(result).not.toBeNull();
        expect(result!.timestamp).toBeInstanceOf(Date);
      }),
      { numRuns: 50 },
    );
  });

  it('the returned timestamp is a Date object for lastKnown results too', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbLatitude,
        arbLongitude,
        arbAccuracy,
        fc.integer({ min: 0, max: THIRTY_MINUTES_MS }),
        async (lat, lng, accuracy, ageMs) => {
          await db.locations.clear();

          const now = Date.now();
          const locationTimestamp = new Date(now - ageMs);

          await locationService.storeLocation({
            latitude: lat,
            longitude: lng,
            accuracy,
            timestamp: locationTimestamp,
            method: 'live',
          });

          vi.spyOn(Date, 'now').mockReturnValue(now);
          stubGPSFailure();

          const result = await locationService.getCurrentLocation();

          expect(result).not.toBeNull();
          expect(result!.timestamp).toBeInstanceOf(Date);

          vi.restoreAllMocks();
        },
      ),
      { numRuns: 50 },
    );
  });
});
