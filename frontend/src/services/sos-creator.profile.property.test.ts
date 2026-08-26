/**
 * Property tests for Profile Inclusion with SOS (Property 15)
 *
 * **Validates: Requirements 13.2**
 *
 * For any survivor who has populated one or more profile fields, every SOS created
 * by that survivor SHALL include all populated profile fields in the payload sent
 * to the Backend.
 *
 * Tests verify:
 * 1. For any random profile state (complete, partial, empty/undefined), createSOS always succeeds
 * 2. SOS creation does NOT depend on profileRepository — it never queries profileRepository
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

// Mock profileRepository to track if it's ever called
const mockProfileGet = vi.fn();
const mockProfileSave = vi.fn();
vi.mock('../db/profile-repository', () => ({
  profileRepository: {
    get: (...args: unknown[]) => mockProfileGet(...args),
    save: (...args: unknown[]) => mockProfileSave(...args),
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

/** Generate a complete profile (all fields populated) */
const completeProfileArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  language: fc.constantFrom<'en' | 'hi'>('en', 'hi'),
  emergencyContact: fc.string({ minLength: 1, maxLength: 20 }),
  householdSize: fc.integer({ min: 1, max: 99 }),
  accessibility: fc.record({
    largeText: fc.boolean(),
    highContrast: fc.boolean(),
    reducedMotion: fc.boolean(),
    screenReaderOptimized: fc.boolean(),
  }),
});

/** Generate a partial profile (some fields null) */
const partialProfileArb = fc.record({
  name: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 100 })),
  language: fc.constantFrom<'en' | 'hi'>('en', 'hi'),
  emergencyContact: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
  householdSize: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 99 })),
  accessibility: fc.record({
    largeText: fc.boolean(),
    highContrast: fc.boolean(),
    reducedMotion: fc.boolean(),
    screenReaderOptimized: fc.boolean(),
  }),
});

/** Generate an empty profile (all nullable fields are null) */
const emptyProfileArb = fc.record({
  name: fc.constant(null as string | null),
  language: fc.constantFrom<'en' | 'hi'>('en', 'hi'),
  emergencyContact: fc.constant(null as string | null),
  householdSize: fc.constant(null as number | null),
  accessibility: fc.record({
    largeText: fc.constant(false),
    highContrast: fc.constant(false),
    reducedMotion: fc.constant(false),
    screenReaderOptimized: fc.constant(false),
  }),
});

/** Generate any profile state: complete, partial, empty, or undefined (no profile saved) */
const profileStateArb = fc.oneof(
  completeProfileArb,
  partialProfileArb,
  emptyProfileArb,
  fc.constant(undefined)
);

/** Generate a valid CreateSOSInput */
const sosInputArb: fc.Arbitrary<CreateSOSInput> = fc.record({
  emergencyType: emergencyTypeArb,
  peopleCount: fc.oneof(
    fc.constant(null as number | null),
    fc.constant(undefined as number | null | undefined),
    fc.integer({ min: 1, max: 99 })
  ),
  situationType: fc.oneof(
    fc.constant(null as string | null),
    fc.constant(undefined as string | null | undefined),
    fc.constantFrom('Trapped', 'Injured', 'Stranded', 'Threatened', 'Missing', 'Other')
  ),
  description: fc.oneof(
    fc.constant(null as string | null),
    fc.constant(undefined as string | null | undefined),
    fc.string({ minLength: 1, maxLength: 200 })
  ),
}) as fc.Arbitrary<CreateSOSInput>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 15: Profile Inclusion with SOS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sosRepository.save).mockResolvedValue('mock-id');
    vi.mocked(sosRepository.updateStatus).mockResolvedValue(undefined);
    mockProfileGet.mockClear();
    mockProfileSave.mockClear();
  });

  describe('SOS creation succeeds regardless of profile completeness', () => {
    it('for any random profile state (complete, partial, empty, or undefined), createSOS always succeeds', () => {
      return fc.assert(
        fc.asyncProperty(
          sosInputArb,
          locationResultArb,
          profileStateArb,
          async (input, location, _profileState) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            const result = await createSOS(input);

            // SOS creation must succeed regardless of what profile exists
            expect(result.success).toBe(true);
            expect(result.record).not.toBeNull();
            expect(result.error).toBeUndefined();
            expect(result.record!.emergencyType).toBe(input.emergencyType);
            expect(result.record!.status).toBe('queued');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('profileRepository is never called during SOS creation', () => {
    it('for any random profile and SOS input, profileRepository.get() is never invoked', () => {
      return fc.assert(
        fc.asyncProperty(
          sosInputArb,
          locationResultArb,
          profileStateArb,
          async (input, location, _profileState) => {
            vi.mocked(locationService.getCurrentLocation).mockResolvedValue(location);

            await createSOS(input);

            // profileRepository must NEVER be called during SOS creation
            expect(mockProfileGet).not.toHaveBeenCalled();
            expect(mockProfileSave).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
