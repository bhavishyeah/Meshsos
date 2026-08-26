/**
 * Property tests for Responder Status Validity (Property 29)
 *
 * **Validates: Requirements 19.1**
 *
 * The Responder_PWA SHALL allow the responder to set their status to one of:
 * Available, Busy, Assigned, En Route, On Scene, or Offline.
 * Any other status value must be rejected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  VALID_RESPONDER_STATUSES,
  isValidResponderStatus,
  updateResponderStatus,
  ResponderValidationError,
} from './responder.service.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../db/index.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../websocket/index.js', () => ({
  broadcastStatusChange: vi.fn(),
  broadcastLocationUpdate: vi.fn(),
}));

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a valid responder status */
const validStatusArb = fc.constantFrom(...VALID_RESPONDER_STATUSES);

/** Generate a random string that is NOT a valid responder status */
const invalidStatusArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !VALID_RESPONDER_STATUSES.includes(s as any));

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 29: Responder Status Validity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('valid statuses are always accepted by isValidResponderStatus', () => {
    fc.assert(
      fc.property(validStatusArb, (status) => {
        expect(isValidResponderStatus(status)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('any string not in VALID_RESPONDER_STATUSES is rejected by isValidResponderStatus', () => {
    fc.assert(
      fc.property(invalidStatusArb, (status) => {
        expect(isValidResponderStatus(status)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('updateResponderStatus throws ResponderValidationError for any invalid status', async () => {
    await fc.assert(
      fc.asyncProperty(invalidStatusArb, async (invalidStatus) => {
        await expect(
          updateResponderStatus('responder-1', invalidStatus as any, 'actor-1')
        ).rejects.toThrow(ResponderValidationError);
      }),
      { numRuns: 100 }
    );
  });
});
