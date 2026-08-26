/**
 * Property tests for Priority Score Calculation (Property 24)
 *
 * **Validates: Requirements 35.1, 35.2, 35.3**
 *
 * For any SOS, the Priority Engine SHALL calculate the score as the sum of applicable
 * factors (Medical +40, Vulnerable +25, 5+ people +20, wait >15min +15, high-risk zone +20)
 * capped at 100, assign band (81-100 Critical, 61-80 High, 31-60 Medium, 0-30 Low),
 * and use only available factors when data is missing.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  calculatePriority,
  assignBand,
  FACTOR_POINTS,
  MAX_SCORE,
  WAIT_THRESHOLD_MS,
  type PriorityInput,
} from './priority.service.js';
import type { EmergencyType } from '../../../shared/src/types/enums.js';

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a valid EmergencyType */
const emergencyTypeArb = fc.constantFrom<EmergencyType>(
  'police',
  'medical',
  'food',
  'childrenElderly'
);

/** Generate a people count that can be null or a positive integer */
const peopleCountArb = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 100 })
);

/** Generate hasActiveDisaster that can be undefined, true, or false */
const hasActiveDisasterArb = fc.oneof(
  fc.constant(undefined as boolean | undefined),
  fc.constant(true as boolean | undefined),
  fc.constant(false as boolean | undefined)
);

/** Generate a wait time in minutes (0 to 120 minutes) */
const waitMinutesArb = fc.integer({ min: 0, max: 120 });

/** Generate a full PriorityInput with associated "now" reference time */
const priorityInputArb = fc.record({
  emergencyType: emergencyTypeArb,
  peopleCount: peopleCountArb,
  waitMinutes: waitMinutesArb,
  hasActiveDisaster: hasActiveDisasterArb,
}).map(({ emergencyType, peopleCount, waitMinutes, hasActiveDisaster }) => {
  const now = new Date('2024-06-15T12:00:00Z');
  const createdAt = new Date(now.getTime() - waitMinutes * 60 * 1000);
  const input: PriorityInput = {
    emergencyType,
    peopleCount,
    createdAt,
    regionId: hasActiveDisaster !== undefined ? 'region-001' : null,
    hasActiveDisaster,
  };
  return { input, now };
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 24: Priority Score Calculation', () => {
  describe('Score equals sum of applied factor points, capped at 100', () => {
    it('for any random combination of factors, score = sum of applied factor points capped at MAX_SCORE', () => {
      fc.assert(
        fc.property(priorityInputArb, ({ input, now }) => {
          const result = calculatePriority(input, now);

          // Manually compute expected score from factors
          let expectedRaw = 0;

          // Medical: +40 if emergencyType === 'medical'
          if (input.emergencyType === 'medical') {
            expectedRaw += FACTOR_POINTS.medical;
          }

          // Vulnerable: +25 if emergencyType === 'childrenElderly'
          if (input.emergencyType === 'childrenElderly') {
            expectedRaw += FACTOR_POINTS.vulnerable;
          }

          // 5+ people: +20 if peopleCount !== null && peopleCount >= 5
          if (input.peopleCount !== null && input.peopleCount >= 5) {
            expectedRaw += FACTOR_POINTS.fivePlusPeople;
          }

          // Wait > 15 min: +15 if elapsed > 15 minutes
          const elapsed = now.getTime() - input.createdAt.getTime();
          if (elapsed > WAIT_THRESHOLD_MS) {
            expectedRaw += FACTOR_POINTS.waitOver15Min;
          }

          // High-risk zone: +20 if hasActiveDisaster === true
          if (input.hasActiveDisaster !== undefined && input.hasActiveDisaster !== null && input.hasActiveDisaster === true) {
            expectedRaw += FACTOR_POINTS.highRiskZone;
          }

          const expectedScore = Math.min(expectedRaw, MAX_SCORE);

          expect(result.score).toBe(expectedScore);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Band assignment matches score ranges', () => {
    it('for any score 81-100, band is critical; 61-80 is high; 31-60 is medium; 0-30 is low', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (score) => {
            const band = assignBand(score);

            if (score >= 81) {
              expect(band).toBe('critical');
            } else if (score >= 61) {
              expect(band).toBe('high');
            } else if (score >= 31) {
              expect(band).toBe('medium');
            } else {
              expect(band).toBe('low');
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('calculated band matches assignBand(score) for any input', () => {
      fc.assert(
        fc.property(priorityInputArb, ({ input, now }) => {
          const result = calculatePriority(input, now);
          expect(result.band).toBe(assignBand(result.score));
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Score is always >= 0 and <= 100', () => {
    it('score is bounded within [0, 100] for any input combination', () => {
      fc.assert(
        fc.property(priorityInputArb, ({ input, now }) => {
          const result = calculatePriority(input, now);
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(MAX_SCORE);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Medical and Vulnerable are mutually exclusive', () => {
    it('medical and vulnerable factors never both apply (max realistic score is 95)', () => {
      fc.assert(
        fc.property(priorityInputArb, ({ input, now }) => {
          const result = calculatePriority(input, now);

          const medicalApplied = result.factors.find(
            (f) => f.name === 'Medical emergency'
          )?.applied;
          const vulnerableApplied = result.factors.find(
            (f) => f.name === 'Vulnerable population'
          )?.applied;

          // Medical and Vulnerable are based on emergencyType, which is a single
          // value — so they can never both be true simultaneously
          expect(medicalApplied && vulnerableApplied).toBe(false);

          // Since they are mutually exclusive, max realistic score is:
          // medical(40) + fivePlus(20) + wait(15) + highRisk(20) = 95
          // or vulnerable(25) + fivePlus(20) + wait(15) + highRisk(20) = 80
          // Therefore score can never exceed 95 in practice
          expect(result.score).toBeLessThanOrEqual(95);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Missing data correctly skips factors', () => {
    it('null peopleCount skips the 5+ people factor', () => {
      fc.assert(
        fc.property(
          emergencyTypeArb,
          hasActiveDisasterArb,
          waitMinutesArb,
          (emergencyType, hasActiveDisaster, waitMinutes) => {
            const now = new Date('2024-06-15T12:00:00Z');
            const createdAt = new Date(now.getTime() - waitMinutes * 60 * 1000);

            const input: PriorityInput = {
              emergencyType,
              peopleCount: null,
              createdAt,
              regionId: 'region-001',
              hasActiveDisaster,
            };

            const result = calculatePriority(input, now);

            const peopleFactor = result.factors.find(
              (f) => f.name === '5+ people affected'
            );
            expect(peopleFactor?.applied).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('undefined hasActiveDisaster skips the high-risk zone factor', () => {
      fc.assert(
        fc.property(
          emergencyTypeArb,
          peopleCountArb,
          waitMinutesArb,
          (emergencyType, peopleCount, waitMinutes) => {
            const now = new Date('2024-06-15T12:00:00Z');
            const createdAt = new Date(now.getTime() - waitMinutes * 60 * 1000);

            const input: PriorityInput = {
              emergencyType,
              peopleCount,
              createdAt,
              regionId: null,
              hasActiveDisaster: undefined,
            };

            const result = calculatePriority(input, now);

            const zoneFactor = result.factors.find(
              (f) => f.name === 'High-risk zone'
            );
            expect(zoneFactor?.applied).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
