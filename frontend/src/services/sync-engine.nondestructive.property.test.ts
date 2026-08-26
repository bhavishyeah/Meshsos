/**
 * Property tests for Non-Destructive Provider Failure (Property 9)
 *
 * **Validates: Requirements 7.2, 7.3**
 *
 * For any random failure scenario, the SOS record's core fields
 * (emergencyType, latitude, longitude, description, timestamp) are
 * never modified by the sync engine. The sync engine never deletes
 * records from the repository on failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { ConnectivityState, LocalSOSRecord, EmergencyType } from '@meshsos/shared';
import type { ConnectivityManager } from './connectivity.service';
import { SyncEngineImpl } from './sync-engine.service';
import { sosRepository } from '../db/sos-repository';

// Mock the sosRepository module
vi.mock('../db/sos-repository', () => ({
  sosRepository: {
    getByStatus: vi.fn(),
    getById: vi.fn(),
    updateStatus: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockConnectivityManager(): ConnectivityManager {
  const state: ConnectivityState = {
    status: 'connected',
    lastChecked: new Date(),
  };

  return {
    getState() {
      return { ...state };
    },
    subscribe() {
      return () => {};
    },
    start() {},
    stop() {},
  };
}

function createMockSOSRecord(
  overrides: Partial<LocalSOSRecord> = {}
): LocalSOSRecord {
  return {
    id: 'sos-default',
    emergencyType: 'medical',
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 10,
    locationMethod: 'live',
    locationTimestamp: new Date('2024-01-01T00:00:00Z'),
    timestamp: new Date('2024-01-01T00:00:00Z'),
    peopleCount: 1,
    situationType: null,
    description: null,
    priority: null,
    status: 'queued',
    retryCount: 0,
    lastTransmissionAttempt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const EMERGENCY_TYPES: EmergencyType[] = ['police', 'medical', 'food', 'childrenElderly'];

/** Arbitrary for generating random failure scenarios */
const failureScenarioArb = fc.record({
  // Network errors vs HTTP error responses
  failureType: fc.constantFrom('networkError', 'httpError') as fc.Arbitrary<'networkError' | 'httpError'>,
  httpStatus: fc.constantFrom(400, 403, 404, 500, 502, 503),
});

/** Arbitrary for generating random SOS records with various core field values */
const sosRecordArb = fc.record({
  id: fc.uuid(),
  emergencyType: fc.constantFrom(...EMERGENCY_TYPES),
  latitude: fc.oneof(fc.double({ min: -90, max: 90, noNaN: true }), fc.constant(null)),
  longitude: fc.oneof(fc.double({ min: -180, max: 180, noNaN: true }), fc.constant(null)),
  accuracy: fc.oneof(fc.double({ min: 0, max: 1000, noNaN: true }), fc.constant(null)),
  locationMethod: fc.constantFrom('live' as const, 'lastKnown' as const, null),
  description: fc.oneof(fc.string({ minLength: 0, maxLength: 200 }), fc.constant(null)),
  peopleCount: fc.oneof(fc.integer({ min: 1, max: 100 }), fc.constant(null)),
  situationType: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
  retryCount: fc.integer({ min: 0, max: 9 }),
  timestampMs: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
}).map((fields) => {
  const timestamp = new Date(fields.timestampMs);
  return createMockSOSRecord({
    id: fields.id,
    emergencyType: fields.emergencyType,
    latitude: fields.latitude,
    longitude: fields.longitude,
    accuracy: fields.accuracy,
    locationMethod: fields.locationMethod,
    description: fields.description,
    peopleCount: fields.peopleCount,
    situationType: fields.situationType,
    retryCount: fields.retryCount,
    timestamp,
    locationTimestamp: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 9: Non-Destructive Provider Failure', () => {
  let engine: SyncEngineImpl;

  beforeEach(() => {
    vi.mocked(sosRepository.getByStatus).mockResolvedValue([]);
    vi.mocked(sosRepository.getById).mockResolvedValue(undefined);
    vi.mocked(sosRepository.updateStatus).mockResolvedValue(undefined);
    vi.mocked(sosRepository.update).mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (engine) engine.stop();
    vi.restoreAllMocks();
  });

  it('should never modify core SOS fields (emergencyType, latitude, longitude, description, timestamp) on failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        sosRecordArb,
        failureScenarioArb,
        async (record, scenario) => {
          // Arrange: mock fetch to always fail
          if (scenario.failureType === 'networkError') {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
          } else {
            global.fetch = vi.fn().mockResolvedValue({
              ok: false,
              status: scenario.httpStatus,
            });
          }

          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);
          vi.mocked(sosRepository.update).mockResolvedValue(undefined);

          const connectivity = createMockConnectivityManager();
          engine = new SyncEngineImpl(connectivity, {
            baseRetryMs: 30000,
            maxRetryMs: 300000,
            maxRetries: 10,
            apiBaseUrl: '/api',
          });

          // Act
          await engine.syncNow();

          // Assert: sosRepository.update was called, but only with
          // retryCount, lastTransmissionAttempt, and optionally status fields
          const updateCalls = vi.mocked(sosRepository.update).mock.calls;

          for (const [, updateFields] of updateCalls) {
            const fieldsObj = updateFields as Partial<LocalSOSRecord>;

            // Core fields must NEVER appear in an update on failure
            expect(fieldsObj).not.toHaveProperty('emergencyType');
            expect(fieldsObj).not.toHaveProperty('latitude');
            expect(fieldsObj).not.toHaveProperty('longitude');
            expect(fieldsObj).not.toHaveProperty('description');
            expect(fieldsObj).not.toHaveProperty('timestamp');
            expect(fieldsObj).not.toHaveProperty('accuracy');
            expect(fieldsObj).not.toHaveProperty('locationMethod');
            expect(fieldsObj).not.toHaveProperty('locationTimestamp');
            expect(fieldsObj).not.toHaveProperty('peopleCount');
            expect(fieldsObj).not.toHaveProperty('situationType');
            expect(fieldsObj).not.toHaveProperty('id');
            expect(fieldsObj).not.toHaveProperty('createdAt');
            expect(fieldsObj).not.toHaveProperty('priority');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should never call delete on the repository on failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        sosRecordArb,
        failureScenarioArb,
        async (record, scenario) => {
          // Arrange: create a spy for delete (should never be called)
          const deleteSpy = vi.fn();
          (sosRepository as any).delete = deleteSpy;

          if (scenario.failureType === 'networkError') {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
          } else {
            global.fetch = vi.fn().mockResolvedValue({
              ok: false,
              status: scenario.httpStatus,
            });
          }

          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);
          vi.mocked(sosRepository.update).mockResolvedValue(undefined);

          const connectivity = createMockConnectivityManager();
          engine = new SyncEngineImpl(connectivity, {
            baseRetryMs: 30000,
            maxRetryMs: 300000,
            maxRetries: 10,
            apiBaseUrl: '/api',
          });

          // Act
          await engine.syncNow();

          // Assert: delete was never called
          expect(deleteSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should only update retryCount, lastTransmissionAttempt, and optionally status fields on failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        sosRecordArb,
        failureScenarioArb,
        async (record, scenario) => {
          // Clear mocks between iterations to avoid stale call history
          vi.mocked(sosRepository.update).mockClear();
          vi.mocked(sosRepository.getByStatus).mockClear();

          // Arrange: mock fetch to always fail
          if (scenario.failureType === 'networkError') {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
          } else {
            global.fetch = vi.fn().mockResolvedValue({
              ok: false,
              status: scenario.httpStatus,
            });
          }

          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);
          vi.mocked(sosRepository.update).mockResolvedValue(undefined);

          const connectivity = createMockConnectivityManager();
          engine = new SyncEngineImpl(connectivity, {
            baseRetryMs: 30000,
            maxRetryMs: 300000,
            maxRetries: 10,
            apiBaseUrl: '/api',
          });

          // Act
          await engine.syncNow();

          // Assert: every update call only touches the allowed fields
          const ALLOWED_FIELDS = new Set([
            'retryCount',
            'lastTransmissionAttempt',
            'status',
          ]);

          const updateCalls = vi.mocked(sosRepository.update).mock.calls;
          expect(updateCalls.length).toBeGreaterThan(0);

          for (const [id, updateFields] of updateCalls) {
            expect(id).toBe(record.id);
            const keys = Object.keys(updateFields as object);
            for (const key of keys) {
              expect(ALLOWED_FIELDS.has(key)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
