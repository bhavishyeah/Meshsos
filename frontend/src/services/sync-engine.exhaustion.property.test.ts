/**
 * Property tests for Retry Exhaustion (Property 7)
 *
 * **Validates: Requirements 5.3**
 *
 * For any SOS record that has failed delivery for 10 consecutive attempts,
 * the system SHALL mark it as permanentlyFailed and cease automatic retry.
 * Below 10 retries, the record remains queued.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { ConnectivityState, LocalSOSRecord } from '@meshsos/shared';
import type { ConnectivityManager } from './connectivity.service';
import { SyncEngineImpl } from './sync-engine.service';

// Mock sosRepository
vi.mock('../db/sos-repository', () => ({
  sosRepository: {
    getByStatus: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

import { sosRepository } from '../db/sos-repository';

// Mock fetch to always fail
const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 10;

function createStubConnectivityManager(): ConnectivityManager {
  const state: ConnectivityState = { status: 'connected', lastChecked: new Date() };
  return {
    getState: () => state,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  };
}

function createEngine(): SyncEngineImpl {
  return new SyncEngineImpl(createStubConnectivityManager(), {
    baseRetryMs: 30000,
    maxRetryMs: 300000,
    maxRetries: MAX_RETRIES,
    apiBaseUrl: '/api',
  });
}

function makeSOSRecord(retryCount: number): LocalSOSRecord {
  return {
    id: `sos-${retryCount}-${Math.random().toString(36).slice(2)}`,
    emergencyType: 'medical',
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 10,
    locationMethod: 'live',
    locationTimestamp: new Date(),
    timestamp: new Date(),
    peopleCount: 1,
    situationType: null,
    description: null,
    priority: null,
    status: 'queued',
    retryCount,
    lastTransmissionAttempt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Generators ─────────────────────────────────────────────────────────────

/**
 * Retry counts that will result in exhaustion after the next failure:
 * retryCount >= 9 means newRetryCount (retryCount + 1) >= 10
 */
const exhaustedRetryCountArb = fc.integer({ min: 9, max: 50 });

/**
 * Retry counts that will NOT exhaust after the next failure:
 * retryCount < 9 means newRetryCount (retryCount + 1) < 10
 */
const nonExhaustedRetryCountArb = fc.integer({ min: 0, max: 8 });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 7: Retry Exhaustion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockRejectedValue(new Error('Network error'));
  });

  describe('Transition to permanentlyFailed at exactly maxRetries', () => {
    it('for any retryCount >= 9, on failure, sosRepository.update is called with status=permanentlyFailed', () => {
      fc.assert(
        fc.asyncProperty(exhaustedRetryCountArb, async (retryCount) => {
          vi.clearAllMocks();
          mockFetch.mockRejectedValue(new Error('Network error'));

          const record = makeSOSRecord(retryCount);

          // Mock getByStatus to return this single record
          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);

          const engine = createEngine();
          await engine.syncNow();

          // Verify sosRepository.update was called with permanentlyFailed
          expect(sosRepository.update).toHaveBeenCalledWith(
            record.id,
            expect.objectContaining({
              status: 'permanentlyFailed',
              retryCount: retryCount + 1,
            })
          );
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Remains queued below maxRetries', () => {
    it('for any retryCount < 9, on failure, sosRepository.update is NOT called with status=permanentlyFailed', () => {
      fc.assert(
        fc.asyncProperty(nonExhaustedRetryCountArb, async (retryCount) => {
          vi.clearAllMocks();
          mockFetch.mockRejectedValue(new Error('Network error'));

          const record = makeSOSRecord(retryCount);

          vi.mocked(sosRepository.getByStatus).mockResolvedValue([record]);

          const engine = createEngine();
          await engine.syncNow();

          // Verify sosRepository.update was called WITHOUT permanentlyFailed status
          expect(sosRepository.update).toHaveBeenCalledWith(
            record.id,
            expect.objectContaining({
              retryCount: retryCount + 1,
            })
          );
          // Ensure the call did NOT include status: 'permanentlyFailed'
          const updateCalls = vi.mocked(sosRepository.update).mock.calls;
          const callForRecord = updateCalls.find(([id]) => id === record.id);
          expect(callForRecord).toBeDefined();
          const updateFields = callForRecord![1] as Partial<LocalSOSRecord>;
          expect(updateFields.status).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });
  });
});
