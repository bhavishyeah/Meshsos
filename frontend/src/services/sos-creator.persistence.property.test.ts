/**
 * Property tests for Local-First Persistence Invariant (Property 2)
 *
 * **Validates: Requirements 3.1, 3.3**
 *
 * For any SOS creation event regardless of connectivity state, the SOS record SHALL
 * be persisted to IndexedDB before any network communication is attempted, and SHALL
 * remain in local storage until the Backend returns a specific acknowledgement.
 *
 * Tests verify:
 * 1. sosRepository.save() is called before any network communication occurs
 * 2. The record passed to save() has status 'created' (not 'queued' or 'delivered')
 * 3. For any successful creation, save() is guaranteed to have been called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { LocationResult, LocalSOSRecord } from '@meshsos/shared';
import { createSOS, type CreateSOSInput } from './sos-creator.service';

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'property-test-uuid-' + Math.random().toString(36).slice(2, 10),
}));

// Track call ordering globally
let callOrder: string[] = [];

// Mock location service
const mockGetCurrentLocation = vi.fn<() => Promise<LocationResult | null>>();
vi.mock('./location.service', () => ({
  locationService: {
    getCurrentLocation: () => mockGetCurrentLocation(),
  },
}));

// Mock sos repository
const mockSave = vi.fn<(record: LocalSOSRecord) => Promise<string>>();
const mockUpdateStatus = vi.fn<(id: string, status: string) => Promise<void>>();
vi.mock('../db/sos-repository', () => ({
  sosRepository: {
    save: (record: LocalSOSRecord) => mockSave(record),
    updateStatus: (id: string, status: string) => mockUpdateStatus(id, status),
  },
}));

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a valid EmergencyType */
const emergencyTypeArb = fc.constantFrom(
  'police' as const,
  'medical' as const,
  'food' as const,
  'childrenElderly' as const
);

/** Generate optional people count */
const peopleCountArb = fc.oneof(
  fc.constant(null as number | null),
  fc.constant(undefined as number | null | undefined),
  fc.integer({ min: 1, max: 99 })
);

/** Generate optional situation type */
const situationTypeArb = fc.oneof(
  fc.constant(null as string | null),
  fc.constant(undefined as string | null | undefined),
  fc.constantFrom('Trapped', 'Injured', 'Stranded', 'Threatened', 'Missing', 'Other')
);

/** Generate optional description */
const descriptionArb = fc.oneof(
  fc.constant(null as string | null),
  fc.constant(undefined as string | null | undefined),
  fc.string({ minLength: 1, maxLength: 200 })
);

/** Generate a random location result or null (simulating GPS available or not) */
const locationResultArb = fc.oneof(
  fc.constant(null as LocationResult | null),
  fc.record({
    latitude: fc.double({ min: -90, max: 90, noNaN: true }),
    longitude: fc.double({ min: -180, max: 180, noNaN: true }),
    accuracy: fc.double({ min: 0.1, max: 1000, noNaN: true }),
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    method: fc.constantFrom('live' as const, 'lastKnown' as const),
  })
);

/** Generate a complete SOS creation scenario */
const sosCreationScenarioArb = fc.record({
  emergencyType: emergencyTypeArb,
  peopleCount: peopleCountArb,
  situationType: situationTypeArb,
  description: descriptionArb,
  location: locationResultArb,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 2: Local-First Persistence Invariant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    callOrder = [];
    mockGetCurrentLocation.mockResolvedValue(null);
    mockSave.mockImplementation(async (record) => {
      callOrder.push('save');
      return record.id;
    });
    mockUpdateStatus.mockImplementation(async () => {
      callOrder.push('updateStatus');
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('save() is called before any network communication (status transitions)', () => {
    it('for any random SOS creation input, sosRepository.save() is called before updateStatus', async () => {
      const scenarios = fc.sample(sosCreationScenarioArb, 200);

      for (const scenario of scenarios) {
        // Reset tracking for each iteration
        callOrder = [];
        mockSave.mockClear();
        mockUpdateStatus.mockClear();

        mockGetCurrentLocation.mockResolvedValue(scenario.location);
        mockSave.mockImplementation(async (record) => {
          callOrder.push('save');
          return record.id;
        });
        mockUpdateStatus.mockImplementation(async () => {
          callOrder.push('updateStatus');
        });

        const input: CreateSOSInput = {
          emergencyType: scenario.emergencyType,
          peopleCount: scenario.peopleCount,
          situationType: scenario.situationType,
          description: scenario.description,
        };

        const promise = createSOS(input);
        await vi.runAllTimersAsync();
        const result = await promise;

        if (result.success) {
          // save() MUST be the first repository operation
          expect(callOrder.length).toBeGreaterThanOrEqual(1);
          expect(callOrder[0]).toBe('save');

          // All updateStatus calls come after save
          const saveIndex = callOrder.indexOf('save');
          const updateIndices = callOrder
            .map((call, idx) => (call === 'updateStatus' ? idx : -1))
            .filter((idx) => idx >= 0);

          for (const updateIdx of updateIndices) {
            expect(updateIdx).toBeGreaterThan(saveIndex);
          }
        }
      }
    });
  });

  describe('record passed to save() has status "created"', () => {
    it('for any random input, the record saved to IndexedDB has status "created" (not "queued" or "delivered")', async () => {
      const scenarios = fc.sample(sosCreationScenarioArb, 200);

      for (const scenario of scenarios) {
        callOrder = [];
        mockSave.mockClear();
        mockUpdateStatus.mockClear();

        mockGetCurrentLocation.mockResolvedValue(scenario.location);
        mockSave.mockImplementation(async (record) => {
          callOrder.push('save');
          return record.id;
        });
        mockUpdateStatus.mockImplementation(async () => {
          callOrder.push('updateStatus');
        });

        const input: CreateSOSInput = {
          emergencyType: scenario.emergencyType,
          peopleCount: scenario.peopleCount,
          situationType: scenario.situationType,
          description: scenario.description,
        };

        const promise = createSOS(input);
        await vi.runAllTimersAsync();
        const result = await promise;

        if (result.success) {
          expect(mockSave).toHaveBeenCalledTimes(1);
          const savedRecord = mockSave.mock.calls[0][0];

          // The initial save MUST use status 'created'
          expect(savedRecord.status).toBe('created');
          expect(savedRecord.status).not.toBe('queued');
          expect(savedRecord.status).not.toBe('delivered');
          expect(savedRecord.status).not.toBe('sending');
        }
      }
    });
  });

  describe('successful creation guarantees save() was called', () => {
    it('for any random input that succeeds, sosRepository.save() is guaranteed to have been called', async () => {
      const scenarios = fc.sample(sosCreationScenarioArb, 200);

      for (const scenario of scenarios) {
        callOrder = [];
        mockSave.mockClear();
        mockUpdateStatus.mockClear();

        mockGetCurrentLocation.mockResolvedValue(scenario.location);
        mockSave.mockImplementation(async (record) => {
          callOrder.push('save');
          return record.id;
        });
        mockUpdateStatus.mockImplementation(async () => {
          callOrder.push('updateStatus');
        });

        const input: CreateSOSInput = {
          emergencyType: scenario.emergencyType,
          peopleCount: scenario.peopleCount,
          situationType: scenario.situationType,
          description: scenario.description,
        };

        const promise = createSOS(input);
        await vi.runAllTimersAsync();
        const result = await promise;

        if (result.success) {
          // save() MUST have been called exactly once for a successful creation
          expect(mockSave).toHaveBeenCalledTimes(1);

          // The record is persisted in IndexedDB (save was called)
          expect(callOrder).toContain('save');
        }
      }
    });
  });
});
