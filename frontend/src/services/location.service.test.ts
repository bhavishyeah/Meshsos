import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocationResult } from '@meshsos/shared';
import { db } from '../db';
import { locationService } from './location.service';

/** Helper: a recent timestamp (5 minutes ago) that is within the 30-minute threshold */
const recentTimestamp = () => Date.now() - 5 * 60 * 1000;

describe('LocationService', () => {
  beforeEach(async () => {
    await db.open();
    await db.locations.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCurrentLocation', () => {
    it('should return live location when GPS succeeds', async () => {
      const mockPosition: GeolocationPosition = {
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: 1700000000000,
      };

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (
            success: PositionCallback,
            _error: PositionErrorCallback,
            _options?: PositionOptions,
          ) => {
            success(mockPosition);
          },
        },
      });

      const result = await locationService.getCurrentLocation();

      expect(result).not.toBeNull();
      expect(result!.latitude).toBe(28.6139);
      expect(result!.longitude).toBe(77.209);
      expect(result!.accuracy).toBe(10);
      expect(result!.method).toBe('live');
      expect(result!.timestamp).toEqual(new Date(1700000000000));
    });

    it('should store the location after successful GPS acquisition', async () => {
      const mockPosition: GeolocationPosition = {
        coords: {
          latitude: 12.9716,
          longitude: 77.5946,
          accuracy: 15,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: 1700000001000,
      };

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (success: PositionCallback) => {
            success(mockPosition);
          },
        },
      });

      await locationService.getCurrentLocation();

      const stored = await db.locations.toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].latitude).toBe(12.9716);
      expect(stored[0].longitude).toBe(77.5946);
      expect(stored[0].method).toBe('live');
    });

    it('should fall back to last known location when GPS fails', async () => {
      // Store a previous location (recent, within 30-minute threshold)
      const previousLocation: LocationResult = {
        latitude: 19.076,
        longitude: 72.8777,
        accuracy: 25,
        timestamp: new Date(recentTimestamp()),
        method: 'live',
      };
      await locationService.storeLocation(previousLocation);

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (
            _success: PositionCallback,
            error: PositionErrorCallback,
          ) => {
            error({
              code: 1,
              message: 'User denied Geolocation',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            });
          },
        },
      });

      const result = await locationService.getCurrentLocation();

      expect(result).not.toBeNull();
      expect(result!.latitude).toBe(19.076);
      expect(result!.longitude).toBe(72.8777);
      expect(result!.method).toBe('lastKnown');
    });

    it('should fall back to last known location when GPS times out', async () => {
      const previousLocation: LocationResult = {
        latitude: 13.0827,
        longitude: 80.2707,
        accuracy: 30,
        timestamp: new Date(recentTimestamp()),
        method: 'live',
      };
      await locationService.storeLocation(previousLocation);

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (
            _success: PositionCallback,
            error: PositionErrorCallback,
          ) => {
            error({
              code: 3,
              message: 'Timeout expired',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            });
          },
        },
      });

      const result = await locationService.getCurrentLocation();

      expect(result).not.toBeNull();
      expect(result!.latitude).toBe(13.0827);
      expect(result!.method).toBe('lastKnown');
    });

    it('should return null when GPS fails and no stored location exists', async () => {
      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (
            _success: PositionCallback,
            error: PositionErrorCallback,
          ) => {
            error({
              code: 2,
              message: 'Position unavailable',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            });
          },
        },
      });

      const result = await locationService.getCurrentLocation();

      expect(result).toBeNull();
    });

    it('should return null when Geolocation API is not available and no stored location exists', async () => {
      vi.stubGlobal('navigator', {});

      const result = await locationService.getCurrentLocation();

      expect(result).toBeNull();
    });

    it('should use enableHighAccuracy and 10s timeout in GPS options', async () => {
      let capturedOptions: PositionOptions | undefined;

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (
            success: PositionCallback,
            _error: PositionErrorCallback,
            options?: PositionOptions,
          ) => {
            capturedOptions = options;
            success({
              coords: {
                latitude: 0,
                longitude: 0,
                accuracy: 5,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            });
          },
        },
      });

      await locationService.getCurrentLocation();

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.enableHighAccuracy).toBe(true);
      expect(capturedOptions!.timeout).toBe(10000);
    });
  });

  describe('getLastKnownLocation', () => {
    it('should return null when no locations are stored', async () => {
      const result = await locationService.getLastKnownLocation();
      expect(result).toBeNull();
    });

    it('should return the most recent stored location with method lastKnown', async () => {
      await locationService.storeLocation({
        latitude: 10.0,
        longitude: 20.0,
        accuracy: 50,
        timestamp: new Date(recentTimestamp() - 60000), // 6 min ago
        method: 'live',
      });
      await locationService.storeLocation({
        latitude: 30.0,
        longitude: 40.0,
        accuracy: 15,
        timestamp: new Date(recentTimestamp()), // 5 min ago
        method: 'live',
      });

      const result = await locationService.getLastKnownLocation();

      expect(result).not.toBeNull();
      expect(result!.latitude).toBe(30.0);
      expect(result!.longitude).toBe(40.0);
      expect(result!.method).toBe('lastKnown');
    });
  });

  describe('storeLocation', () => {
    it('should persist a location to IndexedDB', async () => {
      const location: LocationResult = {
        latitude: 22.5726,
        longitude: 88.3639,
        accuracy: 12,
        timestamp: new Date(1700000500000),
        method: 'live',
      };

      await locationService.storeLocation(location);

      const stored = await db.locations.toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].latitude).toBe(22.5726);
      expect(stored[0].longitude).toBe(88.3639);
      expect(stored[0].accuracy).toBe(12);
      expect(stored[0].timestamp).toEqual(new Date(1700000500000));
      expect(stored[0].method).toBe('live');
    });

    it('should allow storing multiple locations', async () => {
      await locationService.storeLocation({
        latitude: 1.0,
        longitude: 2.0,
        accuracy: 5,
        timestamp: new Date(1700000000000),
        method: 'live',
      });
      await locationService.storeLocation({
        latitude: 3.0,
        longitude: 4.0,
        accuracy: 8,
        timestamp: new Date(1700001000000),
        method: 'live',
      });

      const stored = await db.locations.toArray();
      expect(stored).toHaveLength(2);
    });
  });
});
