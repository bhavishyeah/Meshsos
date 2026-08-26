/**
 * Property tests for Delivery Confirmation Transition (Property 8)
 *
 * **Validates: Requirements 4.2**
 *
 * For any SOS that receives a Backend acknowledgement (HTTP 2xx),
 * the SyncEngine SHALL update its local status to "delivered".
 * For any non-2xx response, the SyncEngine SHALL NOT transition to "delivered".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { ConnectivityState, LocalSOSRecord } from '@meshsos/shared';
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

/**
 * Generate HTTP 2xx status codes (200–299).
 * These represent successful delivery acknowledgement from the backend.
 */
const http2xxStatusArb = fc.integer({ min: 200, max: 299 });

/**
 * Generate non-2xx HTTP status codes (4xx and 5xx).
 * These represent failed delivery attempts where the record should NOT
 * transition to 'delivered'.
 */
const httpNon2xxStatusArb = fc.oneof(
  fc.integer({ min: 400, max: 499 }),
  fc.integer({ min: 500, max: 599 })
);

/**
 * Generate a random queued SOS record with a unique ID.
 */
const queuedSOSRecordArb = fc
  .record({
    id: fc.uuid(),
    retryCount: fc.integer({ min: 0, max: 8 }),
  })
  .map(({ id, retryCount }) =>
    createMockSOSRecord({ id, retryCount })
  );

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 8: Delivery Confirmation Transition', () => {
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

  it('should transition to "delivered" for any HTTP 2xx response', async () => {
    await fc.assert(
      fc.asyncProperty(
        queuedSOSRecordArb,
        http2xxStatusArb,
        async (record, statusCode) => {
          // Arrange
          vi.mocked(sosRepository.updateStatus).mockClear();
          vi.mocked(sosRepository.update).mockClear();

          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);

          global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: statusCode,
          });

          const connectivity = createMockConnectivityManager();
          engine = new SyncEngineImpl(connectivity, {
            baseRetryMs: 30000,
            maxRetryMs: 300000,
            maxRetries: 10,
            apiBaseUrl: '/api',
          });

          // Act
          await engine.syncNow();

          // Assert: updateStatus was called with 'delivered'
          expect(sosRepository.updateStatus).toHaveBeenCalledWith(
            record.id,
            'delivered'
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT transition to "delivered" for any non-2xx HTTP response', async () => {
    await fc.assert(
      fc.asyncProperty(
        queuedSOSRecordArb,
        httpNon2xxStatusArb,
        async (record, statusCode) => {
          // Arrange
          vi.mocked(sosRepository.updateStatus).mockClear();
          vi.mocked(sosRepository.update).mockClear();

          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);

          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: statusCode,
          });

          const connectivity = createMockConnectivityManager();
          engine = new SyncEngineImpl(connectivity, {
            baseRetryMs: 30000,
            maxRetryMs: 300000,
            maxRetries: 10,
            apiBaseUrl: '/api',
          });

          // Act
          await engine.syncNow();

          // Assert: updateStatus was NEVER called with 'delivered'
          const updateStatusCalls = vi.mocked(sosRepository.updateStatus).mock.calls;
          const deliveredCalls = updateStatusCalls.filter(
            ([, status]) => status === 'delivered'
          );
          expect(deliveredCalls).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
