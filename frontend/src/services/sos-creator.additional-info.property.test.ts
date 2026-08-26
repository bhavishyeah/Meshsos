/**
 * Property tests for Additional Information Independence (Property 14)
 *
 * **Validates: Requirements 12.1, 12.2, 12.3**
 *
 * For any SOS creation attempt, the system SHALL complete SOS creation and queuing
 * without requiring any additional information fields (people count, situation type,
 * description) to be provided. The SOS is always valid with or without optional fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { EmergencyType, LocationResult } from '@meshsos/shared';

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

/** Generate a random people count value */
const peopleCountValueArb = fc.integer({ min: 1, max: 10 });

/** Generate a random situation type value */
const situationTypeValueArb = fc.constantFrom(
  'Trapped',
  'Injured',
  'Stranded',
  'Threatened',
  'Missing',
  'Other'
);

/** Generate a random description value (1-200 chars) */
const descriptionValueArb = fc.string({ minLength: 1, maxLength: 200 });

/** Input WITHOUT any optional fields (all null/undefined) */
const inputWithoutOptionalFieldsArb = fc.record({
  emergencyType: emergencyTypeArb,
  peopleCount: fc.constantFrom(null, undefined) as fc.Arbitrary<number | null | undefined>,
  situationType: fc.constantFrom(null, undefined) as fc.Arbitrary<string | null | undefined>,
  description: fc.constantFrom(null, undefined) as fc.Arbitrary<string | null | undefined>,
}) as fc.Arbitrary<CreateSOSInput>;

/** Input WITH random optional fields (all populated) */
const inputWithOptionalFieldsArb = fc.record({
  emergencyType: emergencyTypeArb,
  peopleCount: peopleCountValueArb,
  situationType: situationTypeValueArb,
  description: descriptionValueArb,
}) as fc.Arbitrary<CreateSOSInput>;

// ─── UUID validation helper ─────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 14: Additional Information Independence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sosRepository.save).mockResolvedValue('mock-id');
    vi.mocked(sosRepository.updateStatus).mockResolvedValue(undefined);
  });

  describe('SOS creation succeeds without optional fields', () => {
    it('for any random input WITHOUT optional fields (all null/undefined), createSOS succeeds', () => {
      return fc.assert(
        fc.asyncProperty(
          inputWithoutOptionalFieldsArb,
          locationResultArb,
          async (input, location) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            expect(result.success).toBe(true);
            expect(result.record).not.toBeNull();
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('SOS creation succeeds with optional fields', () => {
    it('for any random input WITH optional fields (random values), createSOS succeeds', () => {
      return fc.assert(
        fc.asyncProperty(
          inputWithOptionalFieldsArb,
          locationResultArb,
          async (input, location) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            expect(result.success).toBe(true);
            expect(result.record).not.toBeNull();
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Optional fields in result match what was provided', () => {
    it('when optional fields are null/undefined, result record has null for those fields', () => {
      return fc.assert(
        fc.asyncProperty(
          inputWithoutOptionalFieldsArb,
          locationResultArb,
          async (input, location) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            expect(result.success).toBe(true);
            expect(result.record!.peopleCount).toBeNull();
            expect(result.record!.situationType).toBeNull();
            expect(result.record!.description).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('when optional fields are provided, result record contains those values', () => {
      return fc.assert(
        fc.asyncProperty(
          inputWithOptionalFieldsArb,
          locationResultArb,
          async (input, location) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            expect(result.success).toBe(true);
            expect(result.record!.peopleCount).toBe(input.peopleCount);
            expect(result.record!.situationType).toBe(input.situationType);
            expect(result.record!.description).toBe(input.description);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('SOS always has valid UUID and emergency type regardless of optional fields', () => {
    it('without optional fields, the SOS has a valid UUID and correct emergency type', () => {
      return fc.assert(
        fc.asyncProperty(
          inputWithoutOptionalFieldsArb,
          locationResultArb,
          async (input, location) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            expect(result.success).toBe(true);
            expect(result.record!.id).toMatch(UUID_REGEX);
            expect(result.record!.emergencyType).toBe(input.emergencyType);
            expect(result.record!.status).toBe('queued');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('with optional fields, the SOS has a valid UUID and correct emergency type', () => {
      return fc.assert(
        fc.asyncProperty(
          inputWithOptionalFieldsArb,
          locationResultArb,
          async (input, location) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            expect(result.success).toBe(true);
            expect(result.record!.id).toMatch(UUID_REGEX);
            expect(result.record!.emergencyType).toBe(input.emergencyType);
            expect(result.record!.status).toBe('queued');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
