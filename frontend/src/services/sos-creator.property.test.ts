/**
 * Property tests for SOS Creation Completeness (Property 1)
 *
 * **Validates: Requirements 1.2, 1.3**
 *
 * For any valid emergency type and optional inputs, the resulting SOS record
 * SHALL contain a valid UUID identifier, the selected emergency type, a timestamp,
 * and all required fields matching the input.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { EmergencyType, LocationResult, LocalSOSRecord } from '@meshsos/shared';

// Mock locationService and sosRepository
vi.mock('./location.service', () => ({
  locationService: {
    getCurrentLocation: vi.fn(),
  },
}));

vi.mock('../db/sos-repository', () => ({
  sosRepository: {
    save: vi.fn().mockResolvedValue('mock-id'),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

import { createSOS, type CreateSOSInput } from './sos-creator.service';
import { locationService } from './location.service';
import { sosRepository } from '../db/sos-repository';

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a valid EmergencyType */
const emergencyTypeArb = fc.constantFrom<EmergencyType>(
  'police',
  'medical',
  'food',
  'childrenElderly'
);

/** Generate an optional people count (null or 1-10) */
const peopleCountArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer({ min: 1, max: 10 })
);

/** Generate an optional situation type */
const situationTypeArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constantFrom('Trapped', 'Injured', 'Stranded', 'Threatened', 'Missing', 'Other')
);

/** Generate an optional description (null or up to 200 chars) */
const descriptionArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string({ minLength: 1, maxLength: 200 })
);

/** Generate a full CreateSOSInput */
const createSOSInputArb = fc.record({
  emergencyType: emergencyTypeArb,
  peopleCount: peopleCountArb,
  situationType: situationTypeArb,
  description: descriptionArb,
}) as fc.Arbitrary<CreateSOSInput>;

/** Generate a mock location result */
const locationResultArb: fc.Arbitrary<LocationResult | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    latitude: fc.double({ min: -90, max: 90, noNaN: true }),
    longitude: fc.double({ min: -180, max: 180, noNaN: true }),
    accuracy: fc.double({ min: 0.5, max: 1000, noNaN: true }),
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    method: fc.constantFrom<'live' | 'lastKnown'>('live', 'lastKnown'),
  })
);

// ─── UUID validation helper ─────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 1: SOS Creation Completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sosRepository.save).mockResolvedValue('mock-id');
    vi.mocked(sosRepository.updateStatus).mockResolvedValue(undefined);
  });

  describe('UUID completeness', () => {
    it('for any random EmergencyType and optional fields, the created record has a valid UUID (non-empty string)', () => {
      return fc.assert(
        fc.asyncProperty(createSOSInputArb, locationResultArb, async (input, location) => {
          vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

          const result = await createSOS(input);

          expect(result.success).toBe(true);
          expect(result.record).not.toBeNull();
          expect(result.record!.id).toBeDefined();
          expect(typeof result.record!.id).toBe('string');
          expect(result.record!.id.length).toBeGreaterThan(0);
          expect(result.record!.id).toMatch(UUID_REGEX);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Timestamp completeness', () => {
    it('for any random input, the created record has a timestamp that is a Date', () => {
      return fc.assert(
        fc.asyncProperty(createSOSInputArb, locationResultArb, async (input, location) => {
          vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

          const result = await createSOS(input);

          expect(result.success).toBe(true);
          expect(result.record).not.toBeNull();
          expect(result.record!.timestamp).toBeInstanceOf(Date);
          expect(isNaN(result.record!.timestamp.getTime())).toBe(false);
          // createdAt should also be a valid Date
          expect(result.record!.createdAt).toBeInstanceOf(Date);
          expect(isNaN(result.record!.createdAt.getTime())).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('EmergencyType matching', () => {
    it('for any random EmergencyType, the created record emergencyType matches the input', () => {
      return fc.assert(
        fc.asyncProperty(createSOSInputArb, locationResultArb, async (input, location) => {
          vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

          const result = await createSOS(input);

          expect(result.success).toBe(true);
          expect(result.record).not.toBeNull();
          expect(result.record!.emergencyType).toBe(input.emergencyType);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Status transitions to queued', () => {
    it('for any random input, the final status is queued', () => {
      return fc.assert(
        fc.asyncProperty(createSOSInputArb, locationResultArb, async (input, location) => {
          // Clear mocks between iterations to avoid accumulated call counts
          vi.mocked(sosRepository.save).mockClear();
          vi.mocked(sosRepository.updateStatus).mockClear();
          vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

          const result = await createSOS(input);

          expect(result.success).toBe(true);
          expect(result.record).not.toBeNull();
          expect(result.record!.status).toBe('queued');

          // Verify the repository was called with state transitions:
          // save (created) -> updateStatus(saved) -> updateStatus(queued)
          expect(sosRepository.save).toHaveBeenCalledTimes(1);
          const savedRecord = vi.mocked(sosRepository.save).mock.calls[0][0] as LocalSOSRecord;
          expect(savedRecord.status).toBe('created');

          expect(sosRepository.updateStatus).toHaveBeenCalledTimes(2);
          expect(vi.mocked(sosRepository.updateStatus).mock.calls[0][1]).toBe('saved');
          expect(vi.mocked(sosRepository.updateStatus).mock.calls[1][1]).toBe('queued');
        }),
        { numRuns: 100 }
      );
    });
  });
});
