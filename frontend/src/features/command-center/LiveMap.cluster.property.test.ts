import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type L from 'leaflet';
import type { MapIncident } from './LiveMap';
import { clusterIncidents } from './LiveMap';

/**
 * Property 27: SOS Cluster Aggregation
 * Validates: Requirements 23.4
 *
 * For any set of SOS incidents, the clustering function must guarantee:
 * 1. The total number of items (clusters + singles) is always <= total incidents
 * 2. Every incident appears in exactly one cluster or as a single (no duplicates, no missing)
 */

// Mock Leaflet CSS import
vi.mock('leaflet/dist/leaflet.css', () => ({}));

// Generator for valid MapIncident objects
const mapIncidentArb = fc.record({
  id: fc.uuid(),
  emergencyType: fc.constantFrom('police' as const, 'medical' as const, 'food' as const, 'childrenElderly' as const),
  latitude: fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
  longitude: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
  priorityBand: fc.constantFrom('critical', 'high', 'medium', 'low'),
  status: fc.constantFrom('delivered', 'acknowledged', 'dispatched', 'enRoute', 'arrived'),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
});

// Create a mock Leaflet map that simulates pixel-based clustering behavior
function createMockMap(zoom: number): L.Map {
  // Simulate latLngToContainerPoint by projecting lat/lng into a simple pixel space
  // This uses a simplified Mercator-like projection for testing purposes
  const scale = Math.pow(2, zoom) * 256 / 360;

  const latLngToContainerPoint = vi.fn((latLng: { lat: number; lng: number }) => {
    const x = (latLng.lng + 180) * scale;
    const y = (90 - latLng.lat) * scale;
    return {
      x,
      y,
      distanceTo(other: { x: number; y: number }) {
        return Math.sqrt((x - other.x) ** 2 + (y - other.y) ** 2);
      },
    };
  });

  return {
    getZoom: vi.fn().mockReturnValue(zoom),
    latLngToContainerPoint,
  } as unknown as L.Map;
}

// Mock L.latLng to return a simple object
vi.mock('leaflet', () => ({
  default: {
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    map: vi.fn(),
    tileLayer: vi.fn(),
    layerGroup: vi.fn(() => ({ addTo: vi.fn(), clearLayers: vi.fn(), addLayer: vi.fn() })),
    circleMarker: vi.fn(() => ({ bindPopup: vi.fn().mockReturnThis(), on: vi.fn() })),
    marker: vi.fn(() => ({ bindPopup: vi.fn().mockReturnThis(), on: vi.fn() })),
    divIcon: vi.fn(),
  },
}));

describe('SOS Cluster Aggregation - Property Test', () => {
  it('total output items (clusters + singles) is always <= total incidents', () => {
    fc.assert(
      fc.property(
        fc.array(mapIncidentArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 13 }), // zoom < 14 to trigger clustering
        (incidents, zoom) => {
          const map = createMockMap(zoom);
          const result = clusterIncidents(incidents, map);

          const totalOutputItems = result.clusters.length + result.singles.length;
          expect(totalOutputItems).toBeLessThanOrEqual(incidents.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('every incident appears in exactly one cluster or as a single (no duplicates, no missing)', () => {
    fc.assert(
      fc.property(
        fc.array(mapIncidentArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 13 }), // zoom < 14 to trigger clustering
        (incidents, zoom) => {
          const map = createMockMap(zoom);
          const result = clusterIncidents(incidents, map);

          // Collect all incident IDs from clusters and singles
          const clusteredIds: string[] = [];
          for (const cluster of result.clusters) {
            for (const inc of cluster.incidents) {
              clusteredIds.push(inc.id);
            }
          }
          const singleIds = result.singles.map((inc) => inc.id);

          const allOutputIds = [...clusteredIds, ...singleIds];

          // Every incident from input must appear exactly once in output
          const inputIds = incidents.map((inc) => inc.id);
          expect(allOutputIds.sort()).toEqual(inputIds.sort());

          // No duplicates in output
          const uniqueOutputIds = new Set(allOutputIds);
          expect(uniqueOutputIds.size).toBe(allOutputIds.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('at zoom >= 14, all incidents are returned as singles with no clusters', () => {
    fc.assert(
      fc.property(
        fc.array(mapIncidentArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 14, max: 20 }),
        (incidents, zoom) => {
          const map = createMockMap(zoom);
          const result = clusterIncidents(incidents, map);

          expect(result.clusters).toHaveLength(0);
          expect(result.singles).toHaveLength(incidents.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('each cluster contains at least 2 incidents', () => {
    fc.assert(
      fc.property(
        fc.array(mapIncidentArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 13 }),
        (incidents, zoom) => {
          const map = createMockMap(zoom);
          const result = clusterIncidents(incidents, map);

          for (const cluster of result.clusters) {
            expect(cluster.incidents.length).toBeGreaterThanOrEqual(2);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
