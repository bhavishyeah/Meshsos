/**
 * Property tests for Queue Delivery Order (Property 5)
 *
 * **Validates: Requirements 4.1**
 *
 * For any set of queued SOS records with distinct creation timestamps,
 * the Sync Engine SHALL attempt delivery in strictly ascending creation-time order (FIFO).
 *
 * Additionally, for any set of records with the same creation timestamp,
 * all records are still processed (no records dropped).
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

const EMERGENCY_TYPES = ['police', 'medical', 'food', 'childrenElderly'] as const;

/**
 * Arbitrary that generates a list of queued SOS records with distinct timestamps.
 * Each record has a unique ID and a unique createdAt timestamp.
 */
const distinctTimestampRecordsArb = fc
  .array(
    fc.record({
      idSuffix: fc.uuid(),
      emergencyType: fc.constantFrom(...EMERGENCY_TYPES),
      createdAtMs: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
    }),
    { minLength: 2, maxLength: 20 }
  )
  .map((items) => {
    // Ensure truly distinct timestamps by spacing them out with large gaps
    return items.map((item, index) => {
      const createdAt = new Date(item.createdAtMs + index * 1000);
      return createMockSOSRecord({
        id: item.idSuffix,
        emergencyType: item.emergencyType,
        createdAt,
        updatedAt: createdAt,
      });
    });
  });

/**
 * Arbitrary that generates a list of queued SOS records all sharing the same
 * creation timestamp but with distinct IDs.
 */
const sameTimestampRecordsArb = fc
  .record({
    count: fc.integer({ min: 2, max: 15 }),
    baseMs: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  })
  .chain(({ count, baseMs }) =>
    fc
      .array(
        fc.record({
          idSuffix: fc.uuid(),
          emergencyType: fc.constantFrom(...EMERGENCY_TYPES),
        }),
        { minLength: count, maxLength: count }
      )
      .map((items) => {
        const createdAt = new Date(baseMs);
        return items.map((item) =>
          createMockSOSRecord({
            id: item.idSuffix,
            emergencyType: item.emergencyType,
            createdAt,
            updatedAt: createdAt,
          })
        );
      })
  );

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 5: Queue Delivery Order', () => {
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

  it('should deliver records in ascending createdAt order (FIFO) for distinct timestamps', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTimestampRecordsArb, async (records) => {
        // Arrange: track POST order by capturing record IDs
        const deliveryOrder: string[] = [];

        global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
          const body = JSON.parse(options.body as string);
          deliveryOrder.push(body.id);
          return Promise.resolve({ ok: true, status: 201 });
        });

        // Shuffle records to simulate arbitrary DB query order
        const shuffled = [...records].sort(() => Math.random() - 0.5);
        vi.mocked(sosRepository.getByStatus).mockResolvedValue(shuffled);

        const connectivity = createMockConnectivityManager();
        engine = new SyncEngineImpl(connectivity, {
          baseRetryMs: 30000,
          maxRetryMs: 300000,
          maxRetries: 10,
          apiBaseUrl: '/api',
        });

        // Act
        deliveryOrder.length = 0;
        await engine.syncNow();

        // Assert: delivery order matches ascending createdAt
        const expectedOrder = [...records]
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
          .map((r) => r.id);

        expect(deliveryOrder).toEqual(expectedOrder);
      }),
      { numRuns: 50 }
    );
  });

  it('should process all records even when they share the same creation timestamp (no dropped records)', async () => {
    await fc.assert(
      fc.asyncProperty(sameTimestampRecordsArb, async (records) => {
        // Arrange: track which records were POSTed
        const deliveredIds: Set<string> = new Set();

        global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
          const body = JSON.parse(options.body as string);
          deliveredIds.add(body.id);
          return Promise.resolve({ ok: true, status: 201 });
        });

        vi.mocked(sosRepository.getByStatus).mockResolvedValue(records);

        const connectivity = createMockConnectivityManager();
        engine = new SyncEngineImpl(connectivity, {
          baseRetryMs: 30000,
          maxRetryMs: 300000,
          maxRetries: 10,
          apiBaseUrl: '/api',
        });

        // Act
        deliveredIds.clear();
        await engine.syncNow();

        // Assert: every record was processed (no record dropped)
        const inputIds = new Set(records.map((r) => r.id));
        expect(deliveredIds).toEqual(inputIds);
      }),
      { numRuns: 50 }
    );
  });
});
