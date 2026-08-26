/**
 * Property test for response metric accuracy (formatDuration).
 *
 * **Validates: Requirements 26.1**
 *
 * Property 36: Response Metric Accuracy
 * Verifies that formatDuration produces correct, non-empty string representations
 * for any non-negative seconds value, with appropriate time unit indicators.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatDuration } from './MetricsDashboard';

describe('formatDuration - Property 36: Response Metric Accuracy', () => {
  /**
   * **Validates: Requirements 26.1**
   * For any non-negative seconds value, formatDuration always returns a non-empty string.
   */
  it('always returns a non-empty string for any non-negative seconds value', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        (seconds) => {
          const result = formatDuration(seconds);
          expect(result).toBeTruthy();
          expect(result.length).toBeGreaterThan(0);
        }
      )
    );
  });

  /**
   * **Validates: Requirements 26.1**
   * For any seconds < 60, the output contains "s" (seconds indicator).
   */
  it('outputs "s" indicator for values under 60 seconds', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 59 }),
        (seconds) => {
          const result = formatDuration(seconds);
          expect(result).toContain('s');
        }
      )
    );
  });

  /**
   * **Validates: Requirements 26.1**
   * For any seconds between 60 and 3599, the output contains "m" (minutes indicator).
   */
  it('outputs "m" indicator for values between 60 and 3599 seconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 3599 }),
        (seconds) => {
          const result = formatDuration(seconds);
          expect(result).toContain('m');
        }
      )
    );
  });

  /**
   * **Validates: Requirements 26.1**
   * For any seconds >= 3600, the output contains "h" (hours indicator).
   */
  it('outputs "h" indicator for values >= 3600 seconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3600, max: 1_000_000 }),
        (seconds) => {
          const result = formatDuration(seconds);
          expect(result).toContain('h');
        }
      )
    );
  });

  /**
   * **Validates: Requirements 26.1**
   * The formatted duration never contains negative numeric values or is an empty string.
   */
  it('never returns negative values or empty strings', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        (seconds) => {
          const result = formatDuration(seconds);
          // Must not be empty
          expect(result.length).toBeGreaterThan(0);
          // Extract all numeric values from the string and verify none are negative
          const numbers = result.match(/-?\d+/g);
          expect(numbers).not.toBeNull();
          for (const num of numbers!) {
            expect(Number(num)).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });
});
