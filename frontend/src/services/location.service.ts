import type { LocationResult } from '@meshsos/shared';
import { db } from '../db';

const GPS_TIMEOUT_MS = 10_000;
const MAX_LOCATION_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface LocationService {
  getCurrentLocation(): Promise<LocationResult | null>;
  getLastKnownLocation(): Promise<LocationResult | null>;
  storeLocation(location: LocationResult): Promise<void>;
}

/**
 * Wraps the Geolocation API in a promise with high accuracy and a 10s timeout.
 */
function requestGPS(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation API not available'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: GPS_TIMEOUT_MS,
      maximumAge: 0,
    });
  });
}

/**
 * Creates a LocationResult from a GeolocationPosition.
 */
function positionToLocationResult(position: GeolocationPosition): LocationResult {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: new Date(position.timestamp),
    method: 'live',
  };
}

/**
 * Default implementation of the LocationService.
 *
 * - Requests live GPS via Geolocation API with a 10s timeout
 * - Falls back to the last known location stored in IndexedDB if GPS is unavailable
 * - Stores each successful location acquisition for future fallback
 * - Returns LocationResult with method indicator ('live' or 'lastKnown')
 */
export const locationService: LocationService = {
  async getCurrentLocation(): Promise<LocationResult | null> {
    try {
      const position = await requestGPS();
      const result = positionToLocationResult(position);
      await this.storeLocation(result);
      return result;
    } catch {
      // GPS failed or timed out — fall back to last known
      return this.getLastKnownLocation();
    }
  },

  async getLastKnownLocation(): Promise<LocationResult | null> {
    const stored = await db.locations.orderBy('timestamp').last();
    if (!stored) {
      return null;
    }

    // Enforce 30-minute maximum age threshold (Requirements 2.2, 2.5)
    const ageMs = Date.now() - stored.timestamp.getTime();
    if (ageMs > MAX_LOCATION_AGE_MS) {
      return null;
    }

    return {
      latitude: stored.latitude,
      longitude: stored.longitude,
      accuracy: stored.accuracy,
      timestamp: stored.timestamp,
      method: 'lastKnown',
    };
  },

  async storeLocation(location: LocationResult): Promise<void> {
    await db.locations.add({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      timestamp: location.timestamp,
      method: location.method,
    });
  },
};
